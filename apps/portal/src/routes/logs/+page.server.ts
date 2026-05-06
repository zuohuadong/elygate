import { db } from '$lib/server/db';
import { logs, users } from '@elygate/db/schema';
import { desc, eq, sql as drizzleSql } from '@elygate/db/operators';
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

export const load: PageServerLoad = async ({ locals, url }) => {
    const { org } = locals as Record<string, any>;
    
    const page = Number(url.searchParams.get('page') || '1');
    const limit = 20;
    const offset = (page - 1) * limit;
    
    const logRows = await db.select({
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
        has_details: drizzleSql<boolean>`EXISTS(SELECT 1 FROM log_details ld WHERE ld.log_id = ${logs.id})`,
    })
    .from(logs)
    .innerJoin(users, eq(logs.userId, users.id))
    .where(eq(logs.orgId, org.id))
    .orderBy(desc(logs.createdAt))
    .limit(limit)
    .offset(offset) as LogRow[];

    return {
        logs: logRows.map((log) => ({
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
