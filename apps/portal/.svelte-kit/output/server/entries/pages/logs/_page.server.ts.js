import { c as desc, m as sql, r as logs, s as users, t as db, u as eq } from "../../../chunks/db.js";
//#region src/routes/logs/+page.server.ts
var load = async ({ locals, url }) => {
	const { org } = locals;
	const page = Number(url.searchParams.get("page") || "1");
	const limit = 20;
	const offset = (page - 1) * limit;
	return {
		logs: (await db.select({
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
			ip_address: logs.ipAddress,
			trace_id: logs.traceId,
			has_details: sql`EXISTS(SELECT 1 FROM log_details ld WHERE ld.log_id = ${logs.id})`
		}).from(logs).innerJoin(users, eq(logs.userId, users.id)).where(eq(logs.orgId, org.id)).orderBy(desc(logs.createdAt)).limit(limit).offset(offset)).map((log) => ({
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
			ipAddress: log.ip_address,
			traceId: log.trace_id,
			hasDetails: Boolean(log.has_details)
		})),
		currentPage: page
	};
};
//#endregion
export { load };
