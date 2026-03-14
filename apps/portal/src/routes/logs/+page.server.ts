import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

type LogRow = {
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
    ip_address: string | null;
    trace_id: string | null;
    has_details: boolean;
};

export const load: PageServerLoad = async ({ parent, url }) => {
    const { org } = await parent();
    
    // Simple pagination and filtering
    const page = Number(url.searchParams.get('page') || '1');
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // Fetch logs with a flag indicating if details exist
    const logs = await sql`
        SELECT l.id, l.user_id, u.username, l.token_id, l.model_name, l.prompt_tokens, l.completion_tokens, 
               l.quota_cost, l.status_code, l.created_at, l.ip_address, l.trace_id,
               EXISTS(SELECT 1 FROM log_details ld WHERE ld.log_id = l.id) as has_details
        FROM logs l
        JOIN users u ON l.user_id = u.id
        WHERE l.org_id = ${org.id}
        ORDER BY l.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
    ` as LogRow[];

    return {
        logs: logs.map((log) => ({
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
