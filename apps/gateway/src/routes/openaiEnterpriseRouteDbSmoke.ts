import { Elysia } from 'elysia';
import { db, sql as rawSql } from '@elygate/db';
import { tokens, users } from '@elygate/db/schema';
import { eq } from 'drizzle-orm';
import { openaiEnterpriseRouter } from './openai-enterprise';

type AppHandle = {
    handle(request: Request): Response | Promise<Response>;
};

function sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://<redacted>@');
}

async function hasBaseSchema(): Promise<boolean> {
    const rows = await rawSql.unsafe("SELECT to_regclass('public.users')::text AS table_name");
    return Boolean(rows[0]?.table_name);
}

async function bootstrapFreshDatabaseIfNeeded(): Promise<void> {
    if (await hasBaseSchema()) return;

    const initSqlPath = new URL('../../../../packages/db/src/init.sql', import.meta.url);
    const initSql = await Bun.file(initSqlPath).text();
    console.log('[openai-enterprise-route-db-smoke] base schema missing; applying packages/db/src/init.sql');
    await rawSql.unsafe(initSql);
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function stringField(value: unknown, field: string): string {
    assert(value && typeof value === 'object', `${field} response is not an object`);
    const raw = (value as Record<string, unknown>)[field];
    assert(typeof raw === 'string' && raw.length > 0, `${field} missing from response`);
    return raw;
}

async function jsonRequest(app: AppHandle, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await app.handle(new Request(`http://localhost${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'openai-enterprise-route-db-smoke' },
        body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
        throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
}

async function main(): Promise<void> {
    await bootstrapFreshDatabaseIfNeeded();
    await import('../../../../packages/db/src/migrate');

    const suffix = Date.now().toString(36);
    const username = `openai_enterprise_route_smoke_${suffix}`;
    const tokenKey = `sk-openai-enterprise-route-smoke-${suffix}`;

    const [user] = await db.insert(users).values({
        username,
        passwordHash: 'openai-enterprise-route-smoke',
        role: 1,
        quota: 1000000,
    }).returning({ id: users.id });
    assert(user?.id, 'failed to create route smoke user');

    const [token] = await db.insert(tokens).values({
        userId: user.id,
        name: 'openai-enterprise-route-smoke',
        key: tokenKey,
        remainQuota: 1000000,
    }).returning({ id: tokens.id });
    assert(token?.id, 'failed to create route smoke token');

    const app = new Elysia()
        .derive(() => ({
            user: { id: user.id, username, group: 'default', role: 1, quota: 1000000, usedQuota: 0, status: 1 },
            token: { id: token.id, userId: user.id, name: 'route-smoke-token', key: tokenKey, status: 1, remainQuota: 1000000, usedQuota: 0, models: [] },
        }))
        .use(openaiEnterpriseRouter);

    try {
        const assistant = await jsonRequest(app, '/assistants', {
            model: 'gpt-4.1',
            name: 'Route Smoke Assistant',
            instructions: 'Smoke route persistence',
            tools: [{ type: 'code_interpreter' }],
            metadata: { smoke: true },
        });
        const assistantId = stringField(assistant, 'id');
        assert(assistant.object === 'assistant', 'assistant route did not serialize object');

        const assistantList = await jsonRequest(app, '/assistants');
        assert(Array.isArray(assistantList.data) && assistantList.data.length === 1, 'assistant list route did not return persisted row');

        const thread = await jsonRequest(app, '/threads', { metadata: { smoke: true } });
        const threadId = stringField(thread, 'id');
        assert(thread.object === 'thread', 'thread route did not serialize object');

        const message = await jsonRequest(app, `/threads/${threadId}/messages`, {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
        });
        assert(message.object === 'thread.message', 'message route did not serialize object');

        const run = await jsonRequest(app, `/threads/${threadId}/runs`, {
            assistant_id: assistantId,
            model: 'gpt-4.1',
            metadata: { smoke: true },
        });
        const runId = stringField(run, 'id');
        assert(run.object === 'thread.run', 'run route did not serialize object');

        const cancelledRun = await jsonRequest(app, `/threads/${threadId}/runs/${runId}/cancel`, {});
        assert(cancelledRun.status === 'cancelling', 'run cancel route did not persist cancelling state');

        const vectorStore = await jsonRequest(app, '/vector_stores', { name: 'route-smoke-vector-store' });
        const vectorStoreId = stringField(vectorStore, 'id');
        assert(vectorStore.object === 'vector_store', 'vector store route did not serialize object');

        const vectorStoreFile = await jsonRequest(app, `/vector_stores/${vectorStoreId}/files`, {
            file_id: 'file_route_smoke',
        });
        assert(vectorStoreFile.object === 'vector_store.file', 'vector store file route did not serialize object');

        const fineTuningJob = await jsonRequest(app, '/fine_tuning/jobs', {
            model: 'gpt-4.1-mini',
            training_file: 'file_route_smoke_train',
        });
        const fineTuningJobId = stringField(fineTuningJob, 'id');
        assert(fineTuningJob.object === 'fine_tuning.job', 'fine tuning route did not serialize object');

        const cancelledFineTuningJob = await jsonRequest(app, `/fine_tuning/jobs/${fineTuningJobId}/cancel`, {});
        assert(cancelledFineTuningJob.status === 'cancelled', 'fine tuning cancel route did not persist cancelled state');

        console.log('[openai-enterprise-route-db-smoke] ok');
    } finally {
        await db.delete(tokens).where(eq(tokens.id, token.id)).catch(() => undefined);
        await db.delete(users).where(eq(users.id, user.id)).catch(() => undefined);
    }
}

try {
    await main();
} catch (error) {
    console.error(`[openai-enterprise-route-db-smoke] failed: ${sanitizeError(error)}`);
    process.exit(1);
}
