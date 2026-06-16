import { db } from '@elygate/db';
import { agentMemories } from '@elygate/db/schema';
import { and, desc, eq, ilike, inArray, isNull, or, gt, sql as drizzleSql } from 'drizzle-orm';
import { log } from './logger';
import { optionCache } from './optionCache';
import { decryptChannelKeys } from './encryption';
import { memoryCache } from './cache';
import type { TokenRecord, UserRecord } from '../types';

export type MemoryScope = 'user' | 'org' | 'thread';
export type MemoryKind = 'fact' | 'preference' | 'instruction' | 'summary' | 'tool_result';

export const MEMORY_SCOPES = ['user', 'org', 'thread'] as const satisfies readonly MemoryScope[];
export const MEMORY_KINDS = ['fact', 'preference', 'instruction', 'summary', 'tool_result'] as const satisfies readonly MemoryKind[];

export interface MemoryItem {
    id: string;
    scope: MemoryScope;
    kind: MemoryKind;
    content: string;
    confidence: number;
    similarity?: number;
    metadata?: Record<string, unknown>;
    userId?: number;
    tokenId?: number | null;
    orgId?: number | null;
    sourceTraceId?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
}

export interface MemorySearchInput {
    user: UserRecord;
    token: TokenRecord;
    query: string;
    scope?: MemoryScope;
    limit?: number;
    embeddingChannel?: Record<string, any> | null;
    embeddingModel?: string;
}

export interface MemoryWriteInput {
    user: UserRecord;
    token: TokenRecord;
    content: string;
    scope?: MemoryScope;
    kind?: MemoryKind;
    sourceTraceId?: string;
    metadata?: Record<string, unknown>;
    embeddingChannel?: Record<string, any> | null;
    embeddingModel?: string;
}

export interface MemoryRememberJobPayload {
    user: Pick<UserRecord, 'id' | 'group' | 'orgId' | 'role' | 'quota' | 'usedQuota' | 'status'> & { username?: string };
    token: Pick<TokenRecord, 'id' | 'name' | 'key' | 'userId' | 'remainQuota' | 'usedQuota' | 'status' | 'rateLimit'>;
    content: string;
    scope?: MemoryScope;
    kind?: MemoryKind;
    sourceTraceId?: string;
    metadata?: Record<string, unknown>;
    embeddingModel?: string;
}

export interface MemoryListInput {
    limit?: number;
    offset?: number;
    query?: string;
    userId?: number;
    scope?: MemoryScope;
    kind?: MemoryKind;
    includeDeleted?: boolean;
}

export interface MemoryStats {
    total: number;
    active: number;
    deleted: number;
    expired: number;
    byScope: Record<string, number>;
    byKind: Record<string, number>;
}

export interface MemoryProviderHealth {
    ok: boolean;
    provider: string;
    detail?: string;
}

export interface MemoryProvider {
    search(input: MemorySearchInput): Promise<MemoryItem[]>;
    remember(input: MemoryWriteInput): Promise<void>;
    forget(id: string, user: UserRecord): Promise<void>;
    health(): Promise<MemoryProviderHealth>;
}

interface MemoryConfig {
    enabled: boolean;
    readDefault: boolean;
    writeDefault: boolean;
    maxInjectedItems: number;
    scope: MemoryScope;
    minWriteChars: number;
}

const DEFAULT_MAX_INJECTED_ITEMS = 6;
const DEFAULT_MIN_WRITE_CHARS = 24;
const MEMORY_EMBEDDING_DIMENSIONS = 1024;
const MEMORY_MODES = ['off', 'read', 'write', 'read_write'] as const;
type MemoryMode = (typeof MEMORY_MODES)[number];

function getConfig(): MemoryConfig {
    return {
        enabled: optionCache.get('MemoryEnabled', false),
        readDefault: optionCache.get('MemoryReadDefault', false),
        writeDefault: optionCache.get('MemoryWriteDefault', false),
        maxInjectedItems: optionCache.get('MemoryMaxInjectedItems', DEFAULT_MAX_INJECTED_ITEMS),
        scope: optionCache.get('MemoryScope', 'user'),
        minWriteChars: optionCache.get('MemoryMinWriteChars', DEFAULT_MIN_WRITE_CHARS)
    };
}

function normalizeText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
        return value.map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && 'text' in item) return String((item as { text?: unknown }).text || '');
            return '';
        }).filter(Boolean).join('\n').trim();
    }
    return '';
}

export function isMemoryScope(value: unknown): value is MemoryScope {
    return typeof value === 'string' && (MEMORY_SCOPES as readonly string[]).includes(value);
}

export function isMemoryKind(value: unknown): value is MemoryKind {
    return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

export function extractMemoryTextFromMessages(messages: unknown): string {
    if (!Array.isArray(messages)) return '';
    return messages
        .filter((message): message is Record<string, unknown> => !!message && typeof message === 'object')
        .filter((message) => message.role === 'user')
        .map((message) => normalizeText(message.content))
        .filter(Boolean)
        .slice(-4)
        .join('\n')
        .trim();
}

function parseMemoryMode(value: unknown): MemoryMode | undefined {
    if (value === true) return 'read_write';
    if (value === false) return 'off';
    if (typeof value !== 'string') return undefined;
    return (MEMORY_MODES as readonly string[]).includes(value) ? value as MemoryMode : undefined;
}

export function shouldReadMemory(body: Record<string, any>): boolean {
    const config = getConfig();
    if (!config.enabled) return false;
    const mode = parseMemoryMode(body.memory ?? body.metadata?.memory);
    if (mode === 'off' || mode === 'write') return false;
    if (mode === 'read' || mode === 'read_write') return true;
    return config.readDefault;
}

export function shouldWriteMemory(body: Record<string, any>): boolean {
    const config = getConfig();
    if (!config.enabled) return false;
    const mode = parseMemoryMode(body.memory ?? body.metadata?.memory);
    if (mode === 'off' || mode === 'read') return false;
    if (mode === 'write' || mode === 'read_write') return true;
    return config.writeDefault;
}

export function shouldRememberContent(content: string): boolean {
    return content.trim().length >= getConfig().minWriteChars;
}

async function generateEmbedding(text: string, embeddingChannel?: Record<string, any> | null, embeddingModel?: string): Promise<number[] | null> {
    if (!embeddingChannel || !text.trim()) return null;

    const decryptedKeys = decryptChannelKeys(embeddingChannel.key);
    const keys = decryptedKeys.split('\n').map((key: string) => key.trim()).filter(Boolean);
    if (keys.length === 0) return null;

    const activeKey = keys[Math.floor(Math.random() * keys.length)];
    const models = Array.isArray(embeddingChannel.models) ? embeddingChannel.models : [];
    const model = embeddingModel || models.find((item: string) =>
        item.toLowerCase().includes('embedding') ||
        item.toLowerCase().includes('bge-m3') ||
        item.toLowerCase().includes('bge-large')
    ) || models[0];
    if (!model) return null;

    const baseUrl = String(embeddingChannel.baseUrl || '').replace(/\/+$/, '');
    const embeddingsUrl = baseUrl.endsWith('/v1/embeddings')
        ? baseUrl
        : baseUrl.endsWith('/v1')
            ? `${baseUrl}/embeddings`
            : `${baseUrl}/v1/embeddings`;

    const response = await fetch(embeddingsUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${activeKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, input: text })
    });

    if (!response.ok) return null;
    const data = await response.json() as Record<string, any>;
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) return null;

    const vector = embedding.map(Number);
    if (vector.length !== MEMORY_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
        log.warn(`[Memory] embedding dimension mismatch: expected ${MEMORY_EMBEDDING_DIMENSIONS}, got ${vector.length}`);
        return null;
    }

    return vector;
}

function hashContent(content: string): string {
    return new Bun.CryptoHasher('sha256').update(content.trim().toLowerCase()).digest('hex');
}

function getScope(input?: MemoryScope): MemoryScope {
    const configured = getConfig().scope;
    if (input && isMemoryScope(input)) return input;
    return isMemoryScope(configured) ? configured : 'user';
}

function resolveMemoryEmbeddingChannel(model?: string): { channel: Record<string, any> | null; model: string | undefined } {
    const candidates = [
        model,
        optionCache.get('MemoryEmbeddingModel', ''),
        'BAAI/bge-m3',
        'bge-m3',
        'Pro/BAAI/bge-m3',
        'baai/bge-m3'
    ].filter((item): item is string => !!item);

    for (const candidate of candidates) {
        const channel = memoryCache.selectChannels(candidate)[0];
        if (channel) return { channel, model: candidate };
    }

    return { channel: null, model: undefined };
}

function rowToMemoryItem(row: Record<string, any>): MemoryItem {
    return {
        id: row.id,
        scope: row.scope,
        kind: row.kind,
        content: row.content,
        confidence: Number(row.confidence || 1),
        similarity: row.similarity === undefined ? undefined : Number(row.similarity),
        metadata: row.metadata || {},
        userId: row.userId ?? row.user_id,
        tokenId: row.tokenId ?? row.token_id ?? null,
        orgId: row.orgId ?? row.org_id ?? null,
        sourceTraceId: row.sourceTraceId ?? row.source_trace_id ?? null,
        createdAt: row.createdAt ?? row.created_at ?? null,
        updatedAt: row.updatedAt ?? row.updated_at ?? null
    };
}

class PostgresMemoryProvider implements MemoryProvider {
    async search(input: MemorySearchInput): Promise<MemoryItem[]> {
        const query = input.query.trim();
        if (!query) return [];

        const limit = Math.max(1, Math.min(input.limit || getConfig().maxInjectedItems, 20));
        const scope = getScope(input.scope);
        const embedding = await generateEmbedding(query, input.embeddingChannel, input.embeddingModel);

        if (embedding) {
            const vectorLiteral = `[${embedding.join(',')}]`;
            const rows = await db.execute(drizzleSql`
                SELECT id, scope, kind, content, confidence, metadata,
                    1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
                FROM agent_memories
                WHERE user_id = ${input.user.id}
                  AND scope = ${scope}
                  AND deleted_at IS NULL
                  AND (expires_at IS NULL OR expires_at > NOW())
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> ${vectorLiteral}::vector, updated_at DESC
                LIMIT ${limit}
            `) as Record<string, any>[];
            await markMemoriesRead(rows.map((row) => row.id));
            return rows.map(rowToMemoryItem);
        }

        const rows = await db.select().from(agentMemories).where(and(
            eq(agentMemories.userId, input.user.id),
            eq(agentMemories.scope, scope),
            isNull(agentMemories.deletedAt),
            or(isNull(agentMemories.expiresAt), gt(agentMemories.expiresAt, drizzleSql`NOW()`))
        )).limit(limit);

        await markMemoriesRead(rows.map((row) => row.id));

        return rows.map((row) => rowToMemoryItem(row as Record<string, any>));
    }

    async remember(input: MemoryWriteInput): Promise<void> {
        const content = input.content.trim();
        if (!shouldRememberContent(content)) return;

        const scope = getScope(input.scope);
        const kind = input.kind || 'summary';
        const embedding = await generateEmbedding(content, input.embeddingChannel, input.embeddingModel);
        const vectorLiteral = embedding ? `[${embedding.join(',')}]` : null;
        const id = `mem_${crypto.randomUUID().replace(/-/g, '')}`;
        const contentHash = hashContent(content);

        await db.execute(drizzleSql`
            INSERT INTO agent_memories (
                id, user_id, token_id, org_id, scope, kind, content, content_hash,
                embedding, confidence, source_trace_id, metadata
            ) VALUES (
                ${id}, ${input.user.id}, ${input.token.id}, ${input.user.orgId || null}, ${scope}, ${kind}, ${content}, ${contentHash},
                ${vectorLiteral ? drizzleSql`${vectorLiteral}::vector` : null}, 1.0000, ${input.sourceTraceId || null}, ${input.metadata || {}}
            )
            ON CONFLICT (user_id, scope, kind, content_hash) DO UPDATE
            SET content = EXCLUDED.content,
                embedding = COALESCE(EXCLUDED.embedding, agent_memories.embedding),
                token_id = EXCLUDED.token_id,
                org_id = EXCLUDED.org_id,
                source_trace_id = EXCLUDED.source_trace_id,
                metadata = agent_memories.metadata || EXCLUDED.metadata,
                deleted_at = NULL,
                updated_at = NOW()
        `);
    }

    async forget(id: string, user: UserRecord): Promise<void> {
        await db.update(agentMemories)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(agentMemories.id, id), eq(agentMemories.userId, user.id)));
    }

    async health(): Promise<MemoryProviderHealth> {
        return { ok: true, provider: 'postgres' };
    }
}

export const memoryProvider: MemoryProvider = new PostgresMemoryProvider();

export async function buildMemorySystemMessage(input: MemorySearchInput): Promise<Record<string, string> | null> {
    if (!getConfig().enabled) return null;
    const items = await memoryProvider.search(input);
    if (items.length === 0) return null;
    return {
        role: 'system',
        content: `Relevant user memory:\n${items.map((item) => `- ${item.content}`).join('\n')}`
    };
}

export function rememberAsync(input: MemoryWriteInput): void {
    if (!getConfig().enabled) return;
    if (!shouldRememberContent(input.content)) return;
    const payload = toRememberJobPayload(input);
    void import('./jobQueue')
        .then(({ enqueueMemoryRemember }) => enqueueMemoryRemember(payload))
        .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            log.warn('[Memory] queue remember failed, falling back to direct write:', message);
            void processMemoryRememberJob(payload).catch((writeError: unknown) => {
                const writeMessage = writeError instanceof Error ? writeError.message : String(writeError);
                log.warn('[Memory] direct remember fallback failed:', writeMessage);
            });
        })
        .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            log.warn('[Memory] async remember failed:', message);
        });
}

async function markMemoriesRead(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.update(agentMemories)
        .set({ lastReadAt: new Date() })
        .where(inArray(agentMemories.id, ids));
}

function toRememberJobPayload(input: MemoryWriteInput): MemoryRememberJobPayload {
    return {
        user: {
            id: input.user.id,
            username: input.user.username,
            group: input.user.group,
            orgId: input.user.orgId,
            role: input.user.role,
            quota: input.user.quota,
            usedQuota: input.user.usedQuota,
            status: input.user.status
        },
        token: {
            id: input.token.id,
            name: input.token.name,
            key: input.token.key,
            userId: input.token.userId,
            remainQuota: input.token.remainQuota,
            usedQuota: input.token.usedQuota,
            status: input.token.status,
            rateLimit: input.token.rateLimit
        },
        content: input.content,
        scope: input.scope,
        kind: input.kind,
        sourceTraceId: input.sourceTraceId,
        metadata: input.metadata,
        embeddingModel: input.embeddingModel
    };
}

export async function processMemoryRememberJob(payload: MemoryRememberJobPayload): Promise<void> {
    const { channel, model } = resolveMemoryEmbeddingChannel(payload.embeddingModel);
    await memoryProvider.remember({
        user: payload.user as UserRecord,
        token: payload.token as TokenRecord,
        content: payload.content,
        scope: payload.scope,
        kind: payload.kind,
        sourceTraceId: payload.sourceTraceId,
        metadata: payload.metadata,
        embeddingChannel: channel,
        embeddingModel: model
    });
}

export async function listMemories(input: MemoryListInput = {}): Promise<{ data: MemoryItem[]; total: number }> {
    const limit = Math.max(1, Math.min(input.limit || 50, 200));
    const offset = Math.max(0, input.offset || 0);
    const filters = [];
    if (!input.includeDeleted) filters.push(isNull(agentMemories.deletedAt));
    if (input.userId) filters.push(eq(agentMemories.userId, input.userId));
    if (input.scope) filters.push(eq(agentMemories.scope, input.scope));
    if (input.kind) filters.push(eq(agentMemories.kind, input.kind));
    if (input.query) filters.push(ilike(agentMemories.content, `%${input.query}%`));

    const where = filters.length > 0 ? and(...filters) : undefined;
    const rows = await db.select().from(agentMemories)
        .where(where)
        .orderBy(desc(agentMemories.updatedAt))
        .limit(limit)
        .offset(offset);
    const [countRow] = await db.execute(drizzleSql`
        SELECT COUNT(*)::int AS count
        FROM agent_memories
        WHERE (${input.includeDeleted ? drizzleSql`TRUE` : drizzleSql`deleted_at IS NULL`})
          AND (${input.userId ? drizzleSql`user_id = ${input.userId}` : drizzleSql`TRUE`})
          AND (${input.scope ? drizzleSql`scope = ${input.scope}` : drizzleSql`TRUE`})
          AND (${input.kind ? drizzleSql`kind = ${input.kind}` : drizzleSql`TRUE`})
          AND (${input.query ? drizzleSql`content ILIKE ${`%${input.query}%`}` : drizzleSql`TRUE`})
    `) as Record<string, any>[];

    return { data: rows.map((row) => rowToMemoryItem(row as Record<string, any>)), total: Number(countRow?.count || 0) };
}

export async function getMemoryStats(): Promise<MemoryStats> {
    const [summary] = await db.execute(drizzleSql`
        SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()))::int AS active,
            COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
            COUNT(*) FILTER (WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= NOW())::int AS expired
        FROM agent_memories
    `) as Record<string, any>[];
    const scopeRows = await db.execute(drizzleSql`SELECT scope, COUNT(*)::int AS count FROM agent_memories WHERE deleted_at IS NULL GROUP BY scope`) as Record<string, any>[];
    const kindRows = await db.execute(drizzleSql`SELECT kind, COUNT(*)::int AS count FROM agent_memories WHERE deleted_at IS NULL GROUP BY kind`) as Record<string, any>[];
    return {
        total: Number(summary?.total || 0),
        active: Number(summary?.active || 0),
        deleted: Number(summary?.deleted || 0),
        expired: Number(summary?.expired || 0),
        byScope: Object.fromEntries(scopeRows.map((row) => [String(row.scope), Number(row.count || 0)])),
        byKind: Object.fromEntries(kindRows.map((row) => [String(row.kind), Number(row.count || 0)]))
    };
}

export async function softDeleteMemory(id: string): Promise<boolean> {
    const rows = await db.update(agentMemories)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(agentMemories.id, id), isNull(agentMemories.deletedAt)))
        .returning({ id: agentMemories.id });
    return rows.length > 0;
}

export async function purgeDeletedMemories(): Promise<number> {
    const rows = await db.delete(agentMemories)
        .where(drizzleSql`${agentMemories.deletedAt} IS NOT NULL`)
        .returning({ id: agentMemories.id });
    return rows.length;
}

export async function cleanupExpiredMemories(): Promise<number> {
    const rows = await db.update(agentMemories)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(drizzleSql`${agentMemories.deletedAt} IS NULL AND ${agentMemories.expiresAt} IS NOT NULL AND ${agentMemories.expiresAt} <= NOW()`)
        .returning({ id: agentMemories.id });
    return rows.length;
}
