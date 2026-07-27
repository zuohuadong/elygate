import { c as desc, r as logs, s as users, t as db, u as eq } from "../../../../chunks/db.js";
import { t as requireOrgManager } from "../../../../chunks/portalAuth.js";
//#region src/routes/logs/export/+server.ts
var GET = async ({ locals }) => {
	const { org } = requireOrgManager(locals);
	const logRows = await db.select({
		created_at: logs.createdAt,
		model_name: logs.modelName,
		prompt_tokens: logs.promptTokens,
		completion_tokens: logs.completionTokens,
		quota_cost: logs.quotaCost,
		status_code: logs.statusCode,
		ip_address: logs.ipAddress,
		trace_id: logs.traceId,
		username: users.username
	}).from(logs).innerJoin(users, eq(logs.userId, users.id)).where(eq(logs.orgId, org.id)).orderBy(desc(logs.createdAt)).limit(5e3);
	const headers = [
		"Timestamp",
		"User",
		"Model",
		"Prompt Tokens",
		"Completion Tokens",
		"Cost (Credits)",
		"Status",
		"IP Address",
		"Trace ID"
	];
	const rows = logRows.map((log) => [
		new Date(log.created_at).toISOString(),
		log.username,
		log.model_name,
		log.prompt_tokens,
		log.completion_tokens,
		(Number(log.quota_cost) / 1e3).toFixed(4),
		log.status_code,
		log.ip_address || "",
		log.trace_id || ""
	]);
	const csvContent = [headers.join(","), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(","))].join("\n");
	return new Response(csvContent, { headers: {
		"Content-Type": "text/csv",
		"Content-Disposition": `attachment; filename="elygate_audit_logs_${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.csv"`
	} });
};
//#endregion
export { GET };
