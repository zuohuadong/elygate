import { sql } from '$lib/server/db';
import { requireOrgManager } from '$lib/server/portalAuth';
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
    
    // Fetch logs strictly scoped to the organization
    const logs = await sql`
        SELECT 
            l.created_at, 
            l.model_name, 
            l.prompt_tokens, 
            l.completion_tokens, 
            l.quota_cost, 
            l.status_code, 
            l.ip_address,
            l.trace_id,
            u.username
        FROM logs l
        JOIN users u ON l.user_id = u.id
        WHERE l.org_id = ${org.id}
        ORDER BY l.created_at DESC
        LIMIT 5000
    ` as ExportLogRow[];

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

    const rows = logs.map((log) => [
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
