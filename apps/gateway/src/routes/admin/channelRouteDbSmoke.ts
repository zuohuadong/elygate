import { Elysia } from 'elysia';
import { db, sql as rawSql } from '@elygate/db';
import { channels } from '@elygate/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { channelsRouter } from './channels';
import { ChannelType } from '../../providers/types';

type AppHandle = {
    handle(request: Request): Response | Promise<Response>;
};

function sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://<redacted>@');
}

async function hasBaseSchema(): Promise<boolean> {
    const rows = await rawSql.unsafe("SELECT to_regclass('public.channels')::text AS table_name");
    return Boolean(rows[0]?.table_name);
}

async function bootstrapFreshDatabaseIfNeeded(): Promise<void> {
    if (await hasBaseSchema()) return;

    const initSqlPath = new URL('../../../../../packages/db/src/init.sql', import.meta.url);
    const initSql = await Bun.file(initSqlPath).text();
    console.log('[admin-channel-route-db-smoke] base schema missing; applying packages/db/src/init.sql');
    await rawSql.unsafe(initSql);
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function jsonPost(app: AppHandle, path: string, body: unknown = {}): Promise<Record<string, unknown>> {
    const response = await app.handle(new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'admin-channel-route-db-smoke' },
        body: JSON.stringify(body),
    }));
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
        throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
}

async function main(): Promise<void> {
    await bootstrapFreshDatabaseIfNeeded();
    await import('../../../../../packages/db/src/migrate');

    const suffix = Date.now().toString(36);
    const touchedIds: number[] = [];
    const app = new Elysia().use(channelsRouter);
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response(JSON.stringify({
        data: [
            { id: 'deepseek-ai/DeepSeek-V3' },
            { id: 'gpt-4.1' },
            { id: 'text-embedding-3-large' },
        ],
    }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    try {
        const [source] = await db.insert(channels).values({
            name: `route-smoke-source-${suffix}`,
            type: ChannelType.OPENAI,
            key: 'sk-route-smoke',
            baseUrl: 'https://upstream.example.test',
            models: ['old-model', 'gpt-4.1'],
            modelMapping: { stale: 'old-model', keep: 'gpt-4.1' },
            priority: 10,
            weight: 2,
            status: 1,
            keyStrategy: 1,
            keyStatus: { 'sk-route-smoke': 'active' },
            priceRatio: '1.2',
            keyConcurrencyLimit: 3,
            endpointType: 'chat',
            groups: ['default', 'vip'],
        }).returning({ id: channels.id });
        assert(source?.id, 'failed to create source channel');
        touchedIds.push(source.id);

        const copy = await jsonPost(app, `/channels/copy/${source.id}`);
        assert(copy.success === true, 'copy route did not report success');
        const copied = copy.channel as { id?: number; name?: string } | undefined;
        assert(copied?.id, 'copy route did not return copied channel id');
        touchedIds.push(copied.id);

        const [copiedRow] = await db.select().from(channels).where(eq(channels.id, copied.id)).limit(1);
        assert(copiedRow?.status === 3, 'copied channel was not disabled by default');
        assert(copiedRow?.priority === 10 && copiedRow.weight === 2, 'copied channel did not preserve routing metadata');

        const sync = await jsonPost(app, `/channels/${source.id}/sync-models`);
        assert(sync.success === true, 'sync route did not report success');
        assert(sync.modelsCount === 3, 'sync route did not count upstream models');
        assert(sync.added === 2, 'sync route did not report new upstream models');
        assert(sync.removed === 1, 'sync route did not report removed stale models');

        const [syncedRow] = await db.select().from(channels).where(eq(channels.id, source.id)).limit(1);
        assert(Array.isArray(syncedRow?.models) && syncedRow.models.includes('deepseek-ai/DeepSeek-V3'), 'sync route did not persist upstream models');
        assert((syncedRow?.modelMapping as Record<string, unknown>)?.['DeepSeek-V3'] === 'deepseek-ai/DeepSeek-V3', 'sync route did not persist generated alias');
        assert(!((syncedRow?.modelMapping as Record<string, unknown>)?.stale), 'sync route did not remove stale alias');

        console.log('[admin-channel-route-db-smoke] ok');
    } finally {
        globalThis.fetch = originalFetch;
        if (touchedIds.length > 0) await db.delete(channels).where(inArray(channels.id, touchedIds)).catch(() => undefined);
    }
}

try {
    await main();
    process.exit(0);
} catch (error) {
    console.error(`[admin-channel-route-db-smoke] failed: ${sanitizeError(error)}`);
    process.exit(1);
}
