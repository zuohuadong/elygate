import { c as desc, l as and, m as sql, o as tokens, p as inArray, r as logs, s as users, t as db, u as eq } from "../../../chunks/db.js";
import { t as requireOrgManager } from "../../../chunks/portalAuth.js";
import { n as max } from "../../../chunks/aggregate.js";
import { fail } from "@sveltejs/kit";
//#region src/routes/keys/+page.server.ts
var load = async ({ locals }) => {
	const { org } = requireOrgManager(locals);
	return { tokens: (await db.select({
		id: tokens.id,
		name: tokens.name,
		tokenPreview: sql`LEFT(${tokens.key}, 8)`,
		createdAt: tokens.createdAt,
		lastUsedAt: max(logs.createdAt),
		ownerName: users.username,
		ownerRole: users.role
	}).from(tokens).innerJoin(users, eq(tokens.userId, users.id)).leftJoin(logs, eq(logs.tokenId, tokens.id)).where(eq(users.orgId, org.id)).groupBy(tokens.id, tokens.name, tokens.key, tokens.createdAt, users.username, users.role).orderBy(desc(tokens.createdAt))).map((token) => ({
		...token,
		tokenPreview: token.tokenPreview ? `${token.tokenPreview}...` : "N/A"
	})) };
};
var actions = { revokeToken: async ({ request, locals }) => {
	const { org } = requireOrgManager(locals);
	const tokenId = (await request.formData()).get("tokenId");
	if (!tokenId) return fail(400, { message: "Token ID is required" });
	try {
		const orgUserIds = (await db.select({ id: users.id }).from(users).where(eq(users.orgId, org.id))).map((u) => u.id);
		await db.delete(tokens).where(and(eq(tokens.id, Number(tokenId)), inArray(tokens.userId, orgUserIds)));
		return { success: true };
	} catch (err) {
		console.error("Failed to revoke token:", err);
		return fail(500, { message: "Failed to revoke token" });
	}
} };
//#endregion
export { actions, load };
