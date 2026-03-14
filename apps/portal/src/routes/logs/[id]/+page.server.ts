import { sql } from '$lib/server/db';
import { error } from '@sveltejs/kit';
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

export const load: PageServerLoad = async ({ params, parent }) => {
    const { org } = await parent();
    
    const [log] = await sql`
        SELECT l.*, ld.request_body, ld.response_body, u.username
        FROM logs l
        JOIN users u ON l.user_id = u.id
        LEFT JOIN log_details ld ON l.id = ld.log_id
        WHERE l.id = ${params.id} AND l.org_id = ${org.id}
        LIMIT 1
    ` as LogDetailRow[];

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
