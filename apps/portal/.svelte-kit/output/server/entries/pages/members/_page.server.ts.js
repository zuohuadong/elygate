import { c as desc, l as and, s as users, t as db, u as eq } from "../../../chunks/db.js";
import { n as requirePortalMember, t as requireOrgManager } from "../../../chunks/portalAuth.js";
import { t as count } from "../../../chunks/aggregate.js";
import { fail } from "@sveltejs/kit";
//#region src/routes/members/+page.server.ts
var load = async ({ locals }) => {
	const { org } = requirePortalMember(locals);
	return { members: (await db.select({
		id: users.id,
		username: users.username,
		role: users.role,
		quota: users.quota,
		usedQuota: users.usedQuota,
		status: users.status,
		createdAt: users.createdAt
	}).from(users).where(eq(users.orgId, org.id)).orderBy(desc(users.createdAt))).map((m) => ({
		id: m.id,
		username: m.username,
		role: m.role,
		quota: Number(m.quota),
		usedQuota: Number(m.usedQuota),
		status: m.status,
		createdAt: m.createdAt
	})) };
};
var actions = {
	addMember: async ({ request, locals }) => {
		const { org } = requireOrgManager(locals);
		const data = await request.formData();
		const username = data.get("username");
		const role = parseInt(data.get("role"));
		const quota = parseInt(data.get("quota"));
		const password = data.get("password");
		if (!username) return fail(400, { message: "Username is required" });
		if (!password || password.length < 8) return fail(400, { message: "Password must be at least 8 characters" });
		try {
			const passwordHash = await Bun.password.hash(password);
			await db.insert(users).values({
				username,
				role,
				quota,
				usedQuota: 0,
				orgId: org.id,
				passwordHash
			});
			return { success: true };
		} catch (err) {
			console.error("Failed to add member:", err);
			return fail(500, { message: "Failed to add member" });
		}
	},
	updateMember: async ({ request, locals }) => {
		const { org } = requireOrgManager(locals);
		const data = await request.formData();
		const id = data.get("id");
		const role = parseInt(data.get("role"));
		const quota = parseInt(data.get("quota"));
		const status = parseInt(data.get("status"));
		await db.update(users).set({
			role,
			quota,
			status
		}).where(and(eq(users.id, Number(id)), eq(users.orgId, org.id)));
		return { success: true };
	},
	deleteMember: async ({ request, locals }) => {
		const { org } = requireOrgManager(locals);
		const id = (await request.formData()).get("id");
		const [{ count: ownerCount }] = await db.select({ count: count() }).from(users).where(and(eq(users.role, 10), eq(users.status, 1), eq(users.orgId, org.id)));
		const [targetMember] = await db.select({ role: users.role }).from(users).where(and(eq(users.id, Number(id)), eq(users.orgId, org.id)));
		if (Number(ownerCount) <= 1 && targetMember?.role === 10) return fail(400, { error: "Cannot remove the last Organization Owner" });
		await db.delete(users).where(and(eq(users.id, Number(id)), eq(users.orgId, org.id)));
		return { success: true };
	}
};
//#endregion
export { actions, load };
