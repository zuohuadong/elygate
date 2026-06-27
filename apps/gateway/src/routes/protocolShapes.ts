export function extractResponseInputText(input: unknown): string {
    if (typeof input === 'string') return input.trim();
    if (!Array.isArray(input)) return '';
    return input.map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const value = item as Record<string, any>;
        if (typeof value.content === 'string') return value.content;
        if (Array.isArray(value.content)) {
            return value.content.map((part: Record<string, any>) => part.text || '').filter(Boolean).join('\n');
        }
        return '';
    }).filter(Boolean).join('\n').trim();
}

export function serializeFile(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'file',
        bytes: Number(row.bytes || 0),
        created_at: Math.floor(new Date(row.createdAt || Date.now()).getTime() / 1000),
        filename: row.filename,
        purpose: row.purpose,
        status: row.status || 'processed',
        status_details: row.statusDetails || row.status_details || null
    };
}

function ts(value: unknown): number | null {
    if (!value) return null;
    return Math.floor(new Date(value as string).getTime() / 1000);
}

export function serializeBatch(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'batch',
        endpoint: row.endpoint,
        input_file_id: row.inputFileId || row.input_file_id,
        completion_window: row.completionWindow || row.completion_window || '24h',
        status: row.status,
        output_file_id: row.outputFileId || row.output_file_id || null,
        error_file_id: row.errorFileId || row.error_file_id || null,
        created_at: ts(row.createdAt || row.created_at),
        in_progress_at: ts(row.inProgressAt || row.in_progress_at),
        expires_at: ts(row.expiredAt || row.expired_at),
        finalizing_at: ts(row.finalizingAt || row.finalizing_at),
        completed_at: ts(row.completedAt || row.completed_at),
        failed_at: ts(row.failedAt || row.failed_at),
        cancelling_at: ts(row.cancellingAt || row.cancelling_at),
        cancelled_at: ts(row.cancelledAt || row.cancelled_at),
        request_counts: row.requestCounts || row.request_counts || { total: 0, completed: 0, failed: 0 },
        metadata: row.metadata || {},
        errors: row.errors || null
    };
}
