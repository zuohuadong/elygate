import { db } from '$lib/server/db';
import { requireOrgManager } from '$lib/server/portalAuth';
import { logs, users } from '@elygate/db/schema';
import { eq, desc } from '@elygate/db/operators';
import type { RequestHandler } from './$types';

type ExportLogRow = {
    created_at: string | Date;
    username: string;
    model_name: string;
    prompt_tokens: number;
    completion_tokens: number;
    quota_cost: number | string;
    status_code: number;
    ip_address: string | null;
    trace_id: string | null;
};

export const GET: RequestHandler = async ({ locals }) => {
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
        username: users.username,
    })
    .from(logs)
    .innerJoin(users, eq(logs.userId, users.id))
    .where(eq(logs.orgId, org.id))
    .orderBy(desc(logs.createdAt))
    .limit(5000) as ExportLogRow[];

    const headers = [
        'Timestamp',
        'User',
        'Model',
        'Prompt Tokens',
        'Completion Tokens',
        'Cost (Credits)',
        'Status',
        'IP Address',
        'Trace ID'
    ];

    const rows = logRows.map((log) => [
        new Date(log.created_at).toISOString(),
        log.username,
        log.model_name,
        log.prompt_tokens,
        log.completion_tokens,
        (Number(log.quota_cost) / 1000).toFixed(4),
        log.status_code,
        log.ip_address || '',
        log.trace_id || ''
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map((row: Array<string | number>) => row.map((cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    return new Response(csvContent, {
        headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="elygate_audit_logs_${new Date().toISOString().split('T')[0]}.csv"`
        }
    });
};
