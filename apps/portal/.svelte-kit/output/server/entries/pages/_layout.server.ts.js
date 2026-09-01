import { a as sessions, d as gt, i as organizations, l as and, m as sql, s as users, t as db, u as eq } from "../../chunks/db.js";
import { error, redirect } from "@sveltejs/kit";
//#region src/routes/+layout.server.ts
var load = async ({ cookies, url }) => {
	const sessionToken = cookies.get("auth_session");
	if (!sessionToken) {
		if (url.pathname === "/login") return {
			user: null,
			org: null
		};
		throw redirect(302, "/login");
	}
	const [session] = await db.select({
		user_id: sessions.userId,
		username: users.username,
		role: users.role,
		org_id: users.orgId,
		org_name: organizations.name,
		org_total_quota: organizations.quota,
		org_used_quota: organizations.usedQuota
	}).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).leftJoin(organizations, eq(users.orgId, organizations.id)).where(and(eq(sessions.token, sessionToken), gt(sessions.expiresAt, sql`NOW()`))).limit(1);
	if (!session) {
		cookies.delete("auth_session", { path: "/" });
		if (url.pathname === "/login") return {
			user: null,
			org: null
		};
		throw redirect(302, "/login");
	}
	if (url.pathname === "/login") throw redirect(302, "/");
	if (!session.org_id && session.role !== 10) throw error(403, "This portal is for enterprise members only.");
	return {
		user: {
			id: session.user_id,
			username: session.username,
			role: session.role
		},
		org: {
			id: session.org_id,
			name: session.org_name ?? "Unknown Organization",
			totalQuota: Number(session.org_total_quota ?? 0),
			usedQuota: Number(session.org_used_quota ?? 0)
		}
	};
};
//#endregion
export { load };
