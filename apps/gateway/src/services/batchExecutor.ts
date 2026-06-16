import { db } from '@elygate/db';
import { apiBatches, apiFiles } from '@elygate/db/schema';
import { eq, and } from 'drizzle-orm';
import { sql as drizzleSql } from 'drizzle-orm';
import { log } from './logger';

/**
 * Batch 异步执行器
 * 对标 OpenAI Batch API：读取 input_file（JSONL），逐行执行请求，汇总到 output_file。
 * 由 pg-boss worker 调度，每个 batch 对应一个 job。
 *
 * 限制：本执行器仅处理 /v1/chat/completions endpoint（最常见场景）。
 * 其他 endpoint 需要内部调用 gateway dispatcher，此处通过 internal HTTP 调用实现。
 */

const BATCH_PROCESS_INTERVAL_MS = 5000; // 5 秒扫描一次 pending batches

interface BatchLine {
    custom_id: string;
    method: string;
    url: string;
    body: Record<string, any>;
}

/**
 * 解析 JSONL 输入文件内容
 */
function parseJsonl(content: Buffer): BatchLine[] {
    const text = content.toString('utf-8');
    const lines: BatchLine[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            lines.push(JSON.parse(trimmed));
        } catch {
            log.warn(`[BatchExecutor] Skipping malformed JSONL line`);
        }
    }
    return lines;
}

/**
 * 执行单个 batch 请求
 * 通过内部 HTTP 调用 gateway 自身来复用 dispatcher 逻辑
 */
async function executeBatchRequest(
    line: BatchLine,
    batchId: string,
    userId: number,
): Promise<{ custom_id: string; response: Record<string, any> | null; error: Record<string, any> | null }> {
    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';

    // 获取用户的主 token 用于内部调用
    // Batch 模式下使用 batch 专用的内部 token
    const internalToken = process.env.BATCH_INTERNAL_TOKEN || '';

    try {
        const url = line.url.startsWith('/v1/') ? `${gatewayUrl}${line.url}` : `${gatewayUrl}/v1${line.url}`;
        const res = await fetch(url, {
            method: line.method || 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(internalToken ? { 'Authorization': `Bearer ${internalToken}` } : {}),
            },
            body: JSON.stringify(line.body),
        });

        const status = res.status;
        const data = await res.json().catch(() => ({}));

        return {
            custom_id: line.custom_id,
            response: {
                status_code: status,
                request_id: `batch_req_${crypto.randomUUID().replace(/-/g, '')}`,
                body: data,
            },
            error: null,
        };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            custom_id: line.custom_id,
            response: null,
            error: { message },
        };
    }
}

/**
 * 处理一个 batch job
 */
export async function processBatch(batchId: string): Promise<void> {
    log.info(`[BatchExecutor] Processing batch ${batchId}`);

    // 获取 batch 记录
    const [batch] = await db.select()
        .from(apiBatches)
        .where(and(eq(apiBatches.id, batchId)))
        .limit(1);

    if (!batch) {
        log.warn(`[BatchExecutor] Batch ${batchId} not found`);
        return;
    }

    if (batch.status !== 'validating' && batch.status !== 'in_progress') {
        log.info(`[BatchExecutor] Batch ${batchId} status is ${batch.status}, skipping`);
        return;
    }

    // 标记为 in_progress
    await db.update(apiBatches).set({
        status: 'in_progress',
        inProgressAt: new Date(),
    }).where(eq(apiBatches.id, batchId));

    // 获取输入文件
    if (!batch.inputFileId) {
        await db.update(apiBatches).set({
            status: 'failed',
            failedAt: new Date(),
            errors: [{ message: 'No input file associated with this batch' }],
        }).where(eq(apiBatches.id, batchId));
        return;
    }

    const [inputFile] = await db.select({ content: apiFiles.content })
        .from(apiFiles)
        .where(eq(apiFiles.id, batch.inputFileId))
        .limit(1);

    if (!inputFile?.content) {
        await db.update(apiBatches).set({
            status: 'failed',
            failedAt: new Date(),
            errors: [{ message: 'Input file content not found' }],
        }).where(eq(apiBatches.id, batchId));
        return;
    }

    const lines = parseJsonl(inputFile.content as Buffer);
    if (lines.length === 0) {
        await db.update(apiBatches).set({
            status: 'failed',
            failedAt: new Date(),
            errors: [{ message: 'Input file contains no valid requests' }],
        }).where(eq(apiBatches.id, batchId));
        return;
    }

    // 更新 request_counts.total
    await db.update(apiBatches).set({
        requestCounts: { total: lines.length, completed: 0, failed: 0 },
    }).where(eq(apiBatches.id, batchId));

    // 逐行执行
    const outputLines: string[] = [];
    const errorLines: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const line of lines) {
        const result = await executeBatchRequest(line, batchId, batch.userId);
        if (result.error) {
            failed++;
            errorLines.push(JSON.stringify({
                id: `batch_err_${crypto.randomUUID().replace(/-/g, '')}`,
                input_index: completed + failed - 1,
                code: 'request_failed',
                message: result.error.message,
                custom_id: result.custom_id,
            }));
        } else {
            completed++;
            outputLines.push(JSON.stringify({
                id: `batch_req_${crypto.randomUUID().replace(/-/g, '')}`,
                custom_id: result.custom_id,
                response: result.response,
                error: null,
            }));
        }

        // 更新进度
        await db.update(apiBatches).set({
            requestCounts: { total: lines.length, completed, failed },
        }).where(eq(apiBatches.id, batchId));
    }

    // 创建输出文件
    const outputContent = Buffer.from(outputLines.join('\n'), 'utf-8');
    const outputId = `file_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(apiFiles).values({
        id: outputId,
        userId: batch.userId,
        tokenId: batch.tokenId,
        bytes: outputContent.length,
        filename: `batch_${batchId}_output.jsonl`,
        purpose: 'batch_output',
        status: 'processed',
        content: outputContent,
    });

    let errorFileId: string | null = null;
    if (errorLines.length > 0) {
        const errorContent = Buffer.from(errorLines.join('\n'), 'utf-8');
        errorFileId = `file_${crypto.randomUUID().replace(/-/g, '')}`;
        await db.insert(apiFiles).values({
            id: errorFileId,
            userId: batch.userId,
            tokenId: batch.tokenId,
            bytes: errorContent.length,
            filename: `batch_${batchId}_errors.jsonl`,
            purpose: 'batch_output',
            status: 'processed',
            content: errorContent,
        });
    }

    // 标记完成
    await db.update(apiBatches).set({
        status: 'completed',
        outputFileId: outputId,
        errorFileId,
        requestCounts: { total: lines.length, completed, failed },
        completedAt: new Date(),
        finalizingAt: new Date(),
    }).where(eq(apiBatches.id, batchId));

    log.info(`[BatchExecutor] Batch ${batchId} completed: ${completed}/${lines.length} succeeded`);
}

/**
 * 定时扫描 pending batches，将它们提交到 job queue
 */
export async function scanPendingBatches(): Promise<void> {
    try {
        const pending = await db.select({ id: apiBatches.id })
            .from(apiBatches)
            .where(eq(apiBatches.status, 'validating'))
            .limit(10);

        for (const batch of pending) {
            // 标记为 queued 以避免重复处理
            await db.update(apiBatches).set({ status: 'in_progress' })
                .where(and(eq(apiBatches.id, batch.id), eq(apiBatches.status, 'validating')))
                .returning({ id: apiBatches.id });
            // 异步处理
            processBatch(batch.id).catch(e => {
                log.error(`[BatchExecutor] Batch ${batch.id} failed:`, e);
            });
        }
    } catch (e: unknown) {
        log.error('[BatchExecutor] Scan error:', e);
    }
}

/**
 * 启动 batch executor 定时器
 */
let batchTimer: ReturnType<typeof setInterval> | null = null;

export function startBatchExecutor(): void {
    if (batchTimer) return;
    log.info('[BatchExecutor] Starting batch executor (interval: 5s)');
    batchTimer = setInterval(() => {
        scanPendingBatches().catch(e => log.error('[BatchExecutor] Scan failed:', e));
    }, BATCH_PROCESS_INTERVAL_MS);
}

export function stopBatchExecutor(): void {
    if (batchTimer) {
        clearInterval(batchTimer);
        batchTimer = null;
    }
}
