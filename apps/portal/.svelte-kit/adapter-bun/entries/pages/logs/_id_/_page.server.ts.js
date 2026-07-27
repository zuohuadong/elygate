import { l as and, n as logDetails, r as logs, s as users, t as db, u as eq } from "../../../../chunks/db.js";
import { error } from "@sveltejs/kit";
//#region src/routes/logs/[id]/+page.server.ts
var load = async ({ params, locals }) => {
	const { org } = locals;
	const [log] = await db.select({
		id: logs.id,
		user_id: logs.userId,
		username: users.username,
		token_id: logs.tokenId,
		model_name: logs.modelName,
		prompt_tokens: logs.promptTokens,
		completion_tokens: logs.completionTokens,
		quota_cost: logs.quotaCost,
		status_code: logs.statusCode,
		created_at: logs.createdAt,
		elapsed_ms: logs.elapsedMs,
		trace_id: logs.traceId,
		request_body: logDetails.requestBody,
		response_body: logDetails.responseBody
	}).from(logs).innerJoin(users, eq(logs.userId, users.id)).leftJoin(logDetails, eq(logs.id, logDetails.logId)).where(and(eq(logs.id, Number(params.id)), eq(logs.orgId, org.id))).limit(1);
	if (!log) throw error(404, "Log entry not found or access denied");
	return { log: {
		id: log.id,
		userId: log.user_id,
		username: log.username,
		tokenId: log.token_id,
		modelName: log.model_name,
		promptTokens: log.prompt_tokens,
		completionTokens: log.completion_tokens,
		quotaCost: Number(log.quota_cost),
		statusCode: log.status_code,
		createdAt: new Date(log.created_at).toISOString(),
		elapsedMs: log.elapsed_ms,
		traceId: log.trace_id,
		requestBody: log.request_body ? JSON.parse(log.request_body) : null,
		responseBody: log.response_body ? JSON.parse(log.response_body) : null
	} };
};
//#endregion
export { load };
