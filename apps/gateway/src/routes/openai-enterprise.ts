import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { assistants, threads, threadMessages, threadRuns, vectorStores, vectorStoreFiles, fineTuningJobs } from '@elygate/db/schema';
import { eq, and, desc } from 'drizzle-orm';

function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function ts(value: unknown): number | null {
    if (!value) return null;
    return Math.floor(new Date(value as string).getTime() / 1000);
}

function serializeAssistant(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'assistant',
        created_at: ts(row.createdAt),
        name: row.name,
        description: row.description,
        model: row.model,
        instructions: row.instructions,
        tools: row.tools || [],
        file_ids: row.fileIds || [],
        metadata: row.metadata || {},
        temperature: row.temperature ? Number(row.temperature) : 1,
        top_p: row.topP ? Number(row.topP) : 1,
    };
}

function serializeThread(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'thread',
        created_at: ts(row.createdAt),
        metadata: row.metadata || {},
        tool_resources: row.toolResources || {},
    };
}

function serializeMessage(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'thread.message',
        created_at: ts(row.createdAt),
        thread_id: row.threadId,
        role: row.role,
        content: row.content || [],
        assistant_id: row.assistantId || null,
        run_id: row.runId || null,
        attachments: row.attachments || [],
        metadata: row.metadata || {},
    };
}

function serializeRun(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'thread.run',
        created_at: ts(row.createdAt),
        thread_id: row.threadId,
        assistant_id: row.assistantId || null,
        status: row.status,
        required_action: row.requiredAction || null,
        last_error: row.lastError || null,
        expires_at: ts(row.expiresAt),
        started_at: ts(row.startedAt),
        cancelled_at: ts(row.cancelledAt),
        failed_at: ts(row.failedAt),
        completed_at: ts(row.completedAt),
        model: row.model,
        instructions: row.instructions,
        tools: row.tools || [],
        metadata: row.metadata || {},
        temperature: row.temperature ? Number(row.temperature) : 1,
        top_p: row.topP ? Number(row.topP) : 1,
        max_prompt_tokens: row.maxPromptTokens || null,
        max_completion_tokens: row.maxCompletionTokens || null,
        truncation_strategy: row.truncationStrategy || null,
        tool_choice: row.toolChoice || 'auto',
        response_format: row.responseFormat || 'auto',
        usage: row.usage || null,
    };
}

function serializeVectorStore(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'vector_store',
        created_at: ts(row.createdAt),
        name: row.name,
        usage_bytes: Number(row.usageBytes || 0),
        file_counts: row.fileCounts || { in_progress: 0, completed: 0, failed: 0, cancelled: 0, total: 0 },
        status: row.status || 'completed',
        metadata: row.metadata || {},
        expires_after: row.expiresAfter || null,
        expires_at: ts(row.expiresAt),
        last_active_at: ts(row.lastActiveAt),
    };
}

function serializeVectorStoreFile(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'vector_store.file',
        created_at: ts(row.createdAt),
        vector_store_id: row.vectorStoreId,
        status: row.status || 'completed',
        usage_bytes: Number(row.usageBytes || 0),
        last_error: row.lastError || null,
        chunking_strategy: row.chunkingStrategy || null,
    };
}

function serializeFineTuningJob(row: Record<string, any>) {
    return {
        id: row.id,
        object: row.object || 'fine_tuning.job',
        created_at: ts(row.createdAt),
        finished_at: ts(row.finishedAt),
        updated_at: ts(row.updatedAt),
        model: row.model,
        status: row.status,
        fine_tuned_model: row.fineTunedModel || null,
        organization_id: row.organizationId || null,
        training_file: row.trainingFileId,
        validation_file: row.validationFileId || null,
        result_files: row.resultFiles || [],
        hyperparameters: row.hyperparameters || {},
        trained_tokens: row.trainedTokens || null,
        error: row.error || null,
        epochs: row.epochs || null,
        suffix: row.suffix || null,
        integrations: row.integrations || [],
    };
}

export const openaiEnterpriseRouter = new Elysia()

    // ─── Assistants API ───
    .get('/assistants', async ({ user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const order = query?.order === 'asc' ? 'asc' : 'desc';
        const rows = await db.select().from(assistants)
            .where(eq(assistants.userId, user.id))
            .orderBy(order === 'desc' ? desc(assistants.createdAt) : assistants.createdAt)
            .limit(limit);
        return { object: 'list', data: rows.map(serializeAssistant) };
    })
    .post('/assistants', async ({ body, user, token }: ElysiaCtx) => {
        const p = body || {};
        const id = createId('asst');
        const [row] = await db.insert(assistants).values({
            id, userId: user.id, tokenId: token?.id || null,
            name: p.name || null, description: p.description || null,
            model: p.model || 'gpt-4o',
            instructions: p.instructions || null,
            tools: p.tools || [],
            fileIds: p.file_ids || [],
            metadata: p.metadata || {},
            temperature: p.temperature?.toString() || null,
            topP: p.top_p?.toString() || null,
        }).returning();
        return serializeAssistant(row!);
    })
    .get('/assistants/:assistant_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(assistants)
            .where(and(eq(assistants.id, params.assistant_id), eq(assistants.userId, user.id))).limit(1);
        if (!row) { set.status = 404; return { error: { message: 'No assistant found', type: 'not_found' } }; }
        return serializeAssistant(row);
    })
    .post('/assistants/:assistant_id', async ({ params, body, user, set }: ElysiaCtx) => {
        const p = body || {};
        const updates: Record<string, any> = { updatedAt: new Date() };
        if (p.name !== undefined) updates.name = p.name;
        if (p.description !== undefined) updates.description = p.description;
        if (p.model !== undefined) updates.model = p.model;
        if (p.instructions !== undefined) updates.instructions = p.instructions;
        if (p.tools !== undefined) updates.tools = p.tools;
        if (p.file_ids !== undefined) updates.fileIds = p.file_ids;
        if (p.metadata !== undefined) updates.metadata = p.metadata;
        if (p.temperature !== undefined) updates.temperature = p.temperature?.toString() || null;
        if (p.top_p !== undefined) updates.topP = p.top_p?.toString() || null;

        const [row] = await db.update(assistants).set(updates)
            .where(and(eq(assistants.id, params.assistant_id), eq(assistants.userId, user.id))).returning();
        if (!row) { set.status = 404; return { error: { message: 'No assistant found', type: 'not_found' } }; }
        return serializeAssistant(row);
    })
    .delete('/assistants/:assistant_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.delete(assistants)
            .where(and(eq(assistants.id, params.assistant_id), eq(assistants.userId, user.id)))
            .returning({ id: assistants.id });
        if (!row) { set.status = 404; return { error: { message: 'No assistant found', type: 'not_found' } }; }
        return { id: row.id, object: 'assistant', deleted: true };
    })

    // ─── Threads API ───
    .get('/threads', async ({ user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select().from(threads)
            .where(eq(threads.userId, user.id))
            .orderBy(desc(threads.createdAt)).limit(limit);
        return { object: 'list', data: rows.map(serializeThread) };
    })
    .post('/threads', async ({ body, user, token }: ElysiaCtx) => {
        const p = body || {};
        const id = createId('thread');
        const [row] = await db.insert(threads).values({
            id, userId: user.id, tokenId: token?.id || null,
            metadata: p.metadata || {}, toolResources: p.tool_resources || {},
        }).returning();
        return serializeThread(row!);
    })
    .get('/threads/:thread_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(threads)
            .where(and(eq(threads.id, params.thread_id), eq(threads.userId, user.id))).limit(1);
        if (!row) { set.status = 404; return { error: { message: 'No thread found', type: 'not_found' } }; }
        return serializeThread(row);
    })
    .post('/threads/:thread_id', async ({ params, body, user, set }: ElysiaCtx) => {
        const p = body || {};
        const updates: Record<string, any> = { updatedAt: new Date() };
        if (p.metadata !== undefined) updates.metadata = p.metadata;
        if (p.tool_resources !== undefined) updates.toolResources = p.tool_resources;
        const [row] = await db.update(threads).set(updates)
            .where(and(eq(threads.id, params.thread_id), eq(threads.userId, user.id))).returning();
        if (!row) { set.status = 404; return { error: { message: 'No thread found', type: 'not_found' } }; }
        return serializeThread(row);
    })
    .delete('/threads/:thread_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.delete(threads)
            .where(and(eq(threads.id, params.thread_id), eq(threads.userId, user.id)))
            .returning({ id: threads.id });
        if (!row) { set.status = 404; return { error: { message: 'No thread found', type: 'not_found' } }; }
        return { id: row.id, object: 'thread', deleted: true };
    })

    // ─── Thread Messages API ───
    .get('/threads/:thread_id/messages', async ({ params, user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select().from(threadMessages)
            .where(and(eq(threadMessages.threadId, params.thread_id), eq(threadMessages.userId, user.id)))
            .orderBy(desc(threadMessages.createdAt)).limit(limit);
        return { object: 'list', data: rows.map(serializeMessage) };
    })
    .post('/threads/:thread_id/messages', async ({ params, body, user }: ElysiaCtx) => {
        const p = body || {};
        const id = createId('msg');
        const [row] = await db.insert(threadMessages).values({
            id, threadId: params.thread_id, userId: user.id,
            role: p.role || 'user',
            content: p.content || [{ type: 'text', text: typeof p.content === 'string' ? p.content : '' }],
            attachments: p.attachments || [],
            metadata: p.metadata || {},
        }).returning();
        return serializeMessage(row!);
    })
    .get('/threads/:thread_id/messages/:message_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(threadMessages)
            .where(and(eq(threadMessages.id, params.message_id), eq(threadMessages.userId, user.id))).limit(1);
        if (!row) { set.status = 404; return { error: { message: 'No message found', type: 'not_found' } }; }
        return serializeMessage(row);
    })

    // ─── Runs API ───
    .get('/threads/:thread_id/runs', async ({ params, user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select().from(threadRuns)
            .where(and(eq(threadRuns.threadId, params.thread_id), eq(threadRuns.userId, user.id)))
            .orderBy(desc(threadRuns.createdAt)).limit(limit);
        return { object: 'list', data: rows.map(serializeRun) };
    })
    .post('/threads/:thread_id/runs', async ({ params, body, user }: ElysiaCtx) => {
        const p = body || {};
        const id = createId('run');
        const [row] = await db.insert(threadRuns).values({
            id, threadId: params.thread_id, userId: user.id,
            assistantId: p.assistant_id || null,
            model: p.model || null,
            instructions: p.instructions || null,
            tools: p.tools || [],
            metadata: p.metadata || {},
            temperature: p.temperature?.toString() || null,
            topP: p.top_p?.toString() || null,
            maxPromptTokens: p.max_prompt_tokens || null,
            maxCompletionTokens: p.max_completion_tokens || null,
            status: 'queued',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }).returning();
        // 异步触发 run 执行（标记为 in_progress）
        db.update(threadRuns).set({ status: 'in_progress', startedAt: new Date() })
            .where(eq(threadRuns.id, id)).then(() => {
                // 实际 run 执行需要调用 dispatcher，此处仅记录状态
            });
        return serializeRun(row!);
    })
    .get('/threads/:thread_id/runs/:run_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(threadRuns)
            .where(and(eq(threadRuns.id, params.run_id), eq(threadRuns.userId, user.id))).limit(1);
        if (!row) { set.status = 404; return { error: { message: 'No run found', type: 'not_found' } }; }
        return serializeRun(row);
    })
    .post('/threads/:thread_id/runs/:run_id/cancel', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.update(threadRuns).set({
            status: 'cancelling', cancelledAt: new Date(),
        }).where(and(eq(threadRuns.id, params.run_id), eq(threadRuns.userId, user.id))).returning();
        if (!row) { set.status = 404; return { error: { message: 'No run found', type: 'not_found' } }; }
        return serializeRun(row);
    })

    // ─── Vector Stores API ───
    .get('/vector_stores', async ({ user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select().from(vectorStores)
            .where(eq(vectorStores.userId, user.id))
            .orderBy(desc(vectorStores.createdAt)).limit(limit);
        return { object: 'list', data: rows.map(serializeVectorStore) };
    })
    .post('/vector_stores', async ({ body, user, token }: ElysiaCtx) => {
        const p = body || {};
        const id = createId('vs');
        const [row] = await db.insert(vectorStores).values({
            id, userId: user.id, tokenId: token?.id || null,
            name: p.name || null,
            metadata: p.metadata || {},
            expiresAfter: p.expires_after || null,
            fileCounts: { in_progress: 0, completed: 0, failed: 0, cancelled: 0, total: 0 },
        }).returning();
        return serializeVectorStore(row!);
    })
    .get('/vector_stores/:vector_store_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(vectorStores)
            .where(and(eq(vectorStores.id, params.vector_store_id), eq(vectorStores.userId, user.id))).limit(1);
        if (!row) { set.status = 404; return { error: { message: 'No vector store found', type: 'not_found' } }; }
        return serializeVectorStore(row);
    })
    .post('/vector_stores/:vector_store_id', async ({ params, body, user, set }: ElysiaCtx) => {
        const p = body || {};
        const updates: Record<string, any> = {};
        if (p.name !== undefined) updates.name = p.name;
        if (p.metadata !== undefined) updates.metadata = p.metadata;
        if (Object.keys(updates).length === 0) updates.lastActiveAt = new Date();
        const [row] = await db.update(vectorStores).set(updates)
            .where(and(eq(vectorStores.id, params.vector_store_id), eq(vectorStores.userId, user.id))).returning();
        if (!row) { set.status = 404; return { error: { message: 'No vector store found', type: 'not_found' } }; }
        return serializeVectorStore(row);
    })
    .delete('/vector_stores/:vector_store_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.delete(vectorStores)
            .where(and(eq(vectorStores.id, params.vector_store_id), eq(vectorStores.userId, user.id)))
            .returning({ id: vectorStores.id });
        if (!row) { set.status = 404; return { error: { message: 'No vector store found', type: 'not_found' } }; }
        return { id: row.id, object: 'vector_store', deleted: true };
    })

    // ─── Vector Store Files API ───
    .get('/vector_stores/:vector_store_id/files', async ({ params, user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select().from(vectorStoreFiles)
            .where(eq(vectorStoreFiles.vectorStoreId, params.vector_store_id))
            .orderBy(desc(vectorStoreFiles.createdAt)).limit(limit);
        return { object: 'list', data: rows.map(serializeVectorStoreFile) };
    })
    .post('/vector_stores/:vector_store_id/files', async ({ params, body, user }: ElysiaCtx) => {
        const p = body || {};
        const id = createId('file');
        const [row] = await db.insert(vectorStoreFiles).values({
            id, vectorStoreId: params.vector_store_id,
            fileId: p.file_id || null,
            status: 'completed',
            chunkingStrategy: p.chunking_strategy || null,
        }).returning();
        return serializeVectorStoreFile(row!);
    })
    .delete('/vector_stores/:vector_store_id/files/:file_id', async ({ params, set }: ElysiaCtx) => {
        const [row] = await db.delete(vectorStoreFiles)
            .where(eq(vectorStoreFiles.id, params.file_id))
            .returning({ id: vectorStoreFiles.id });
        if (!row) { set.status = 404; return { error: { message: 'No file found', type: 'not_found' } }; }
        return { id: row.id, object: 'vector_store.file', deleted: true };
    })

    // ─── Fine-tuning API ───
    .get('/fine_tuning/jobs', async ({ user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select().from(fineTuningJobs)
            .where(eq(fineTuningJobs.userId, user.id))
            .orderBy(desc(fineTuningJobs.createdAt)).limit(limit);
        return { object: 'list', data: rows.map(serializeFineTuningJob) };
    })
    .post('/fine_tuning/jobs', async ({ body, user, token }: ElysiaCtx) => {
        const p = body || {};
        const id = createId('ftjob');
        const [row] = await db.insert(fineTuningJobs).values({
            id, userId: user.id, tokenId: token?.id || null,
            model: p.model || 'gpt-4o',
            trainingFileId: p.training_file || null,
            validationFileId: p.validation_file || null,
            hyperparameters: p.hyperparameters || {},
            suffix: p.suffix || null,
            integrations: p.integrations || [],
            status: 'validating_files',
        }).returning();
        return serializeFineTuningJob(row!);
    })
    .get('/fine_tuning/jobs/:fine_tuning_job_id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(fineTuningJobs)
            .where(and(eq(fineTuningJobs.id, params.fine_tuning_job_id), eq(fineTuningJobs.userId, user.id))).limit(1);
        if (!row) { set.status = 404; return { error: { message: 'No fine-tuning job found', type: 'not_found' } }; }
        return serializeFineTuningJob(row);
    })
    .post('/fine_tuning/jobs/:fine_tuning_job_id/cancel', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.update(fineTuningJobs).set({
            status: 'cancelled', finishedAt: new Date(), updatedAt: new Date(),
        }).where(and(eq(fineTuningJobs.id, params.fine_tuning_job_id), eq(fineTuningJobs.userId, user.id))).returning();
        if (!row) { set.status = 404; return { error: { message: 'No fine-tuning job found', type: 'not_found' } }; }
        return serializeFineTuningJob(row);
    });
