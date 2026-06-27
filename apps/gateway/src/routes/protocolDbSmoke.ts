import { db, sql as rawSql } from '@elygate/db';
import { apiBatches, apiFiles, tokens, users } from '@elygate/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { processBatch } from '../services/batchExecutor';

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
    console.log('[new-api-protocol-db-smoke] base schema missing; applying packages/db/src/init.sql');
    await rawSql.unsafe(initSql);
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function main(): Promise<void> {
    await bootstrapFreshDatabaseIfNeeded();
    await import('../../../../packages/db/src/migrate');

    const suffix = Date.now().toString(36);
    const username = `protocol_smoke_${suffix}`;
    const tokenKey = `sk-protocol-smoke-${suffix}`;
    const inputFileId = createId('file');
    const batchId = createId('batch');
    const touchedFileIds = new Set<string>([inputFileId]);

    const [user] = await db.insert(users).values({
        username,
        passwordHash: 'protocol-smoke',
        role: 1,
        quota: 1000000,
    }).returning({ id: users.id });
    assert(user?.id, 'failed to create smoke user');

    const [token] = await db.insert(tokens).values({
        userId: user.id,
        name: 'protocol-smoke',
        key: tokenKey,
        remainQuota: 1000000,
    }).returning({ id: tokens.id });
    assert(token?.id, 'failed to create smoke token');

    try {
        const inputContent = Buffer.from(JSON.stringify({
            custom_id: 'request-1',
            method: 'POST',
            url: '/v1/chat/completions',
            body: {
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'smoke' }],
            },
        }) + '\n', 'utf8');

        await db.insert(apiFiles).values({
            id: inputFileId,
            userId: user.id,
            tokenId: token.id,
            bytes: inputContent.length,
            filename: 'protocol-smoke-input.jsonl',
            purpose: 'batch',
            content: inputContent,
        });

        const [storedInput] = await db.select({
            content: apiFiles.content,
            bytes: apiFiles.bytes,
        }).from(apiFiles).where(eq(apiFiles.id, inputFileId)).limit(1);
        assert(storedInput, 'input file was not persisted');
        assert(Number(storedInput.bytes) === inputContent.length, 'input file byte count mismatch');
        assert(Buffer.from(storedInput.content as Buffer).toString('utf8') === inputContent.toString('utf8'), 'input file content mismatch');

        await db.insert(apiBatches).values({
            id: batchId,
            userId: user.id,
            tokenId: token.id,
            endpoint: '/v1/chat/completions',
            inputFileId,
            completionWindow: '24h',
            status: 'validating',
        });

        await processBatch(batchId);

        const [batch] = await db.select().from(apiBatches).where(eq(apiBatches.id, batchId)).limit(1);
        assert(batch, 'batch was not persisted');
        assert(batch.status === 'completed', `expected completed batch, got ${batch.status}`);
        assert(batch.requestCounts?.total === 1, 'batch total count mismatch');
        assert((batch.requestCounts.completed + batch.requestCounts.failed) === 1, 'batch terminal count mismatch');
        assert(batch.outputFileId || batch.errorFileId, 'batch did not create an output or error file');

        if (batch.outputFileId) touchedFileIds.add(batch.outputFileId);
        if (batch.errorFileId) touchedFileIds.add(batch.errorFileId);

        const files = await db.select({
            id: apiFiles.id,
            content: apiFiles.content,
        }).from(apiFiles).where(inArray(apiFiles.id, [...touchedFileIds]));
        const outputFiles = files.filter((file) => file.id !== inputFileId);
        assert(outputFiles.length >= 1, 'batch did not persist terminal result files');
        const nonEmptyTerminalFiles = outputFiles.filter((file) => file.content && Buffer.from(file.content as Buffer).length > 0);
        assert(nonEmptyTerminalFiles.length >= 1, 'batch terminal files did not include persisted result content');

        console.log('[new-api-protocol-db-smoke] ok');
    } finally {
        await db.delete(apiBatches).where(eq(apiBatches.id, batchId)).catch(() => undefined);
        await db.delete(apiFiles).where(inArray(apiFiles.id, [...touchedFileIds])).catch(() => undefined);
        await db.delete(tokens).where(eq(tokens.id, token.id)).catch(() => undefined);
        await db.delete(users).where(eq(users.id, user.id)).catch(() => undefined);
    }
}

try {
    await main();
} catch (error) {
    console.error(`[new-api-protocol-db-smoke] failed: ${sanitizeError(error)}`);
    process.exit(1);
}
