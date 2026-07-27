import { i as organizations, m as sql, t as db, u as eq } from "../../../chunks/db.js";
import { n as requirePortalMember, t as requireOrgManager } from "../../../chunks/portalAuth.js";
//#region src/routes/policy/+page.server.ts
var load = async ({ locals }) => {
	const { org } = requirePortalMember(locals);
	const [policy] = await db.select({
		allowedModels: organizations.allowedModels,
		deniedModels: organizations.deniedModels,
		allowedSubnets: organizations.allowedSubnets,
		alertThresholdPct: organizations.alertThresholdPct,
		alertWebhookUrl: organizations.alertWebhookUrl
	}).from(organizations).where(eq(organizations.id, org.id));
	const availableModels = await db.execute(sql`
        SELECT DISTINCT jsonb_array_elements_text(models) as model
        FROM channels
        ORDER BY model ASC
    `);
	return {
		policy: {
			allowedModels: policy?.allowedModels ?? [],
			deniedModels: policy?.deniedModels ?? [],
			allowedSubnets: policy?.allowedSubnets ?? "",
			alertThresholdPct: Number(policy?.alertThresholdPct ?? 80),
			alertWebhookUrl: policy?.alertWebhookUrl ?? ""
		},
		availableModels: availableModels.map((modelRow) => modelRow.model)
	};
};
var actions = { updatePolicy: async ({ request, locals }) => {
	const { org } = requireOrgManager(locals);
	const formData = await request.formData();
	const allowedSubnets = formData.get("allowedSubnets");
	const alertThresholdPct = parseInt(formData.get("alertThresholdPct"));
	const alertWebhookUrl = formData.get("alertWebhookUrl");
	const allowedModels = JSON.parse(formData.get("allowedModels"));
	const deniedModels = JSON.parse(formData.get("deniedModels"));
	await db.update(organizations).set({
		allowedSubnets,
		alertThresholdPct,
		alertWebhookUrl,
		allowedModels,
		deniedModels,
		updatedAt: /* @__PURE__ */ new Date()
	}).where(eq(organizations.id, org.id));
	return { success: true };
} };
//#endregion
export { actions, load };
