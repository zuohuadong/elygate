import { db } from '$lib/server/db';
import { error } from '@sveltejs/kit';
import { logDetails, logs, users } from '@elygate/db/schema';
import { and, eq } from '@elygate/db/operators';
import type { PageServerLoad } from './$types';

type LogDetailRow = {
    id: number;
    user_id: number;
    username: string;
    token_id: number | null;
    model_name: string;
    prompt_tokens: number;
    completion_tokens: number;
    quota_cost: number | string;
    status_code: number;
    created_at: string | Date;
    elapsed_ms: number | null;
    trace_id: string | null;
    request_body: string | null;
    response_body: string | null;
};

export const load: PageServerLoad = async ({ params, locals }) => {
    const { org } = locals as Record<string, any>;
    
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
        response_body: logDetails.responseBody,
    })
    .from(logs)
    .innerJoin(users, eq(logs.userId, users.id))
    .leftJoin(logDetails, eq(logs.id, logDetails.logId))
    .where(and(eq(logs.id, Number(params.id)), eq(logs.orgId, org.id)))
    .limit(1) as LogDetailRow[];

    if (!log) {
        throw error(404, 'Log entry not found or access denied');
    }

    return {
        log: {
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
        }
    };
};
