import { a as sessions, d as gt, i as organizations, l as and, m as sql, s as users, t as db, u as eq } from "../chunks/db.js";
//#region src/hooks.server.ts
var rateLimits = /* @__PURE__ */ new Map();
var LIMIT = 100;
var WINDOW = 60 * 1e3;
if (typeof setInterval !== "undefined") setInterval(() => {
	const now = Date.now();
	for (const [ip, bucket] of rateLimits.entries()) if (now - bucket.lastReset > WINDOW * 2) rateLimits.delete(ip);
}, WINDOW * 5);
var handle = async ({ event, resolve }) => {
	const ip = event.getClientAddress();
	const now = Date.now();
	const bucket = rateLimits.get(ip) || {
		count: 0,
		lastReset: now
	};
	if (now - bucket.lastReset > WINDOW) {
		bucket.count = 0;
		bucket.lastReset = now;
	}
	bucket.count++;
	rateLimits.set(ip, bucket);
	if (bucket.count > LIMIT) return new Response("Too Many Requests", { status: 429 });
	const sessionToken = event.cookies.get("auth_session");
	if (sessionToken) {
		const [session] = await db.select({
			user_id: sessions.userId,
			username: users.username,
			role: users.role,
			org_id: users.orgId,
			org_name: organizations.name
		}).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).leftJoin(organizations, eq(users.orgId, organizations.id)).where(and(eq(sessions.token, sessionToken), gt(sessions.expiresAt, sql`NOW()`))).limit(1);
		if (session) {
			event.locals.user = {
				id: session.user_id,
				username: session.username,
				role: session.role
			};
			if (session.org_id) event.locals.org = {
				id: session.org_id,
				name: session.org_name
			};
		}
	}
	const response = await resolve(event);
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	response.headers.set("X-XSS-Protection", "1; mode=block");
	response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';");
	return response;
};
//#endregion
export { handle };
