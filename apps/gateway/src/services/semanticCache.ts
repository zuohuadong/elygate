import { log } from '../services/logger';
import { db } from '@elygate/db';
import { semanticCache } from '@elygate/db/schema';
import { sql as drizzleSql } from 'drizzle-orm';
import { optionCache } from './optionCache';
import { decryptChannelKeys } from './encryption';

const DEFAULT_SIMILARITY_THRESHOLD = 0.95;
const DEFAULT_CACHE_TTL_HOURS = 24;
const DEFAULT_ENABLED = true;

interface SemanticCacheConfig {
    enabled: boolean;
    similarityThreshold: number;
    ttlHours: number;
}

function getConfig(): SemanticCacheConfig {
    return {
        enabled: optionCache.get('SemanticCacheEnabled', DEFAULT_ENABLED),
        similarityThreshold: optionCache.get('SemanticCacheThreshold', DEFAULT_SIMILARITY_THRESHOLD),
        ttlHours: optionCache.get('SemanticCacheTTLHours', DEFAULT_CACHE_TTL_HOURS)
    };
}

async function generateEmbedding(text: string, embeddingChannel: Record<string, any>, embeddingModel?: string): Promise<number[] | null> {
    const decryptedKeys = decryptChannelKeys(embeddingChannel.key);
    const keys = decryptedKeys.split('\n').map((k: string) => k.trim()).filter(Boolean);
    const activeKey = keys[Math.floor(Math.random() * keys.length)];

    const model = embeddingModel || embeddingChannel.models.find((m: string) => 
        m.toLowerCase().includes('embedding') || 
        m.toLowerCase().includes('bge-m3') ||
        m.toLowerCase().includes('bge-large')
    ) || embeddingChannel.models[0];

    log.info(`[SemanticCache] Generating embedding with model: ${model}`);

    let baseUrl = (embeddingChannel.baseUrl || '').replace(/\/+$/, '');
    let embeddingsUrl: string;
    
    if (baseUrl.endsWith('/v1/embeddings')) {
        embeddingsUrl = baseUrl;
    } else if (baseUrl.endsWith('/v1')) {
        embeddingsUrl = `${baseUrl}/embeddings`;
    } else {
        embeddingsUrl = `${baseUrl}/v1/embeddings`;
    }

    const response = await fetch(embeddingsUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${activeKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, input: text })
    });

    if (!response.ok) {
        log.info(`[SemanticCache] Embedding API failed: ${response.status} ${response.statusText}`);
        return null;
    }
    const data = await response.json() as Record<string, any>;
    return data?.data?.[0]?.embedding ?? null;
}

/**
 * Vector similarity lookup requires raw SQL (pgvector <=> operator).
 */
export async function lookupSemanticCache(
    prompt: string,
    model: string,
    embeddingChannel: Record<string, any>,
    embeddingModel?: string,
    userId?: number,
    policy?: Record<string, any>
): Promise<any | null> {
    const config = getConfig();
    if (!config.enabled || policy?.mode === 'disabled') return null;

    const embedding = await generateEmbedding(prompt, embeddingChannel, embeddingModel);
    if (!embedding) return null;

    const vectorLiteral = `[${embedding.join(',')}]`;
    
    const isolationClause = (policy?.mode === 'isolated' && userId) 
        ? drizzleSql`AND created_by = ${userId}` 
        : drizzleSql``;

    const smartClause = (policy?.mode === 'smart' && userId)
        ? drizzleSql`AND (created_by != ${userId} OR created_at > NOW() - INTERVAL '2 minutes')`
        : drizzleSql``;

    // Vector similarity search requires raw SQL (pgvector <=> operator)
    const rows = await db.execute(drizzleSql`
        SELECT id, response, created_by, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
        FROM semantic_cache
        WHERE model_name = ${model}
          AND created_at > NOW() - make_interval(hours => ${config.ttlHours})
          ${isolationClause}
        ${smartClause}
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT 1
    `) as any[];

    if (rows.length > 0 && rows[0].similarity >= config.similarityThreshold) {
        log.info(`[SemanticCache] HIT! Similarity: ${rows[0].similarity.toFixed(4)} Mode: ${policy?.mode || 'default'}`);
        const response = rows[0].response;
        if (typeof response === 'string') {
            try {
                return JSON.parse(response);
            } catch {
                return response;
            }
        }
        return response;
    }

    log.info(`[SemanticCache] MISS. Best similarity: ${rows[0]?.similarity?.toFixed(4) ?? 'N/A'}`);
    return null;
}

/**
 * Store requires raw SQL for vector literal and ON CONFLICT with embedding update.
 */
export async function storeSemanticCache(
    prompt: string,
    model: string,
    response: Record<string, any>,
    embeddingChannel: Record<string, any>,
    embeddingModel?: string,
    createdBy?: number,
    policy?: Record<string, any>
): Promise<void> {
    const { enabled } = getConfig();
    if (!enabled || policy?.mode === 'disabled') return;

    const embedding = await generateEmbedding(prompt, embeddingChannel, embeddingModel);
    if (!embedding) return;

    const promptHash = new Bun.CryptoHasher('md5').update(prompt).digest('hex');
    const vectorLiteral = `[${embedding.join(',')}]`;
    await db.execute(drizzleSql`
        INSERT INTO semantic_cache (model_name, prompt_hash, prompt, embedding, response, created_by)
        VALUES (${model}, ${promptHash}, ${prompt}, ${vectorLiteral}::vector, ${response}, ${createdBy || null})
        ON CONFLICT (model_name, prompt_hash) DO UPDATE
        SET response = EXCLUDED.response,
            embedding = EXCLUDED.embedding,
            created_by = EXCLUDED.created_by,
            created_at = NOW()
    `);
}
