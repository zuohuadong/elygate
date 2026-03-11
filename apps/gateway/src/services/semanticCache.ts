import { sql } from '@elygate/db';
import { optionCache } from './optionCache';
import { decryptChannelKeys } from './encryption';

// Default configuration - can be overridden via 'options' table in the database
const DEFAULT_SIMILARITY_THRESHOLD = 0.95; // Cosine similarity threshold (0.0-1.0, higher = more strict)
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

/**
 * Generates a text embedding vector via an OpenAI-compatible embeddings endpoint.
 */
async function generateEmbedding(text: string, embeddingChannel: any, embeddingModel?: string): Promise<number[] | null> {
    // Decrypt the API key
    const decryptedKeys = decryptChannelKeys(embeddingChannel.key);
    const keys = decryptedKeys.split('\n').map((k: string) => k.trim()).filter(Boolean);
    const activeKey = keys[Math.floor(Math.random() * keys.length)];

    // Use the specified embedding model, or find one from the channel's models
    const model = embeddingModel || embeddingChannel.models.find((m: string) => 
        m.toLowerCase().includes('embedding') || 
        m.toLowerCase().includes('bge-m3') ||
        m.toLowerCase().includes('bge-large')
    ) || embeddingChannel.models[0];

    console.log(`[SemanticCache] Generating embedding with model: ${model}`);

    // Smart URL handling: avoid duplicate /v1 prefix
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
        console.log(`[SemanticCache] Embedding API failed: ${response.status} ${response.statusText}`);
        return null;
    }
    const data = await response.json() as any;
    return data?.data?.[0]?.embedding ?? null;
}

/**
 * Retrieves a semantically similar cached response for the given query.
 * Returns the cached response if found within the similarity threshold, otherwise null.
 * 
 * Configurable via options:
 * - SemanticCacheEnabled (bool, default: true)
 * - SemanticCacheThreshold (float, default: 0.92)
 * - SemanticCacheTTLHours (int, default: 24)
 */
export async function lookupSemanticCache(
    prompt: string,
    model: string,
    embeddingChannel: any,
    embeddingModel?: string,
    userId?: number,
    policy?: any
): Promise<any | null> {
    const config = getConfig();
    if (!config.enabled || policy?.mode === 'disabled') return null;

    const embedding = await generateEmbedding(prompt, embeddingChannel, embeddingModel);
    if (!embedding) return null;

    const vectorLiteral = `[${embedding.join(',')}]`;
    
    // Policy: Isolated mode (only hits cache created by this user)
    const isolationClause = (policy?.mode === 'isolated' && userId) 
        ? sql`AND created_by = ${userId}` 
        : sql``;

    const rows = await sql`
        SELECT id, response, created_by, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
        FROM semantic_cache
        WHERE model_name = ${model}
          AND created_at > NOW() - make_interval(hours => ${config.ttlHours})
          ${isolationClause}
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT 1
    `;

    if (rows.length > 0 && rows[0].similarity >= config.similarityThreshold) {
        const cacheId = rows[0].id;
        
        // Policy: Refresh on Count (N-th hit forced refresh)
        if (policy?.mode === 'refresh_on_count' && userId) {
            const refreshN = Number(policy.n) || 3;
            
            // Upsert hit count for this user and cache entry
            const [hit] = await sql`
                INSERT INTO semantic_cache_hits (cache_id, account_id, hit_count)
                VALUES (${cacheId}, ${userId}, 1)
                ON CONFLICT (cache_id, account_id) DO UPDATE
                SET hit_count = semantic_cache_hits.hit_count + 1,
                    last_hit_at = NOW()
                RETURNING hit_count
            `;

            if (hit.hit_count >= refreshN) {
                console.log(`[SemanticCache] Triggered FORCED REFRESH for user ${userId} (Hit ${hit.hit_count}/${refreshN})`);
                // Reset hit count for the next cycle
                await sql`UPDATE semantic_cache_hits SET hit_count = 0 WHERE cache_id = ${cacheId} AND account_id = ${userId}`;
                return null; // Force a miss
            }
            
            console.log(`[SemanticCache] HIT for user ${userId} (Hit ${hit.hit_count}/${refreshN})`);
        } else {
            console.log(`[SemanticCache] GLOBAL HIT! Similarity: ${rows[0].similarity.toFixed(4)}`);
        }
        
        return rows[0].response;
    }

    console.log(`[SemanticCache] MISS. Best similarity: ${rows[0]?.similarity?.toFixed(4) ?? 'N/A'}`);
    return null;
}

/**
 * Stores a new response in the semantic cache for future lookups.
 */
export async function storeSemanticCache(
    prompt: string,
    model: string,
    response: any,
    embeddingChannel: any,
    embeddingModel?: string,
    createdBy?: number
): Promise<void> {
    const { enabled } = getConfig();
    if (!enabled) return;

    const embedding = await generateEmbedding(prompt, embeddingChannel, embeddingModel);
    if (!embedding) return;

    // Use Bun native CryptoHasher for md5 - faster than delegating to SQL
    const promptHash = new Bun.CryptoHasher('md5').update(prompt).digest('hex');
    const vectorLiteral = `[${embedding.join(',')}]`;
    await sql`
        INSERT INTO semantic_cache (model_name, prompt_hash, prompt, embedding, response, created_by)
        VALUES (${model}, ${promptHash}, ${prompt}, ${vectorLiteral}::vector, ${JSON.stringify(response)}, ${createdBy || null})
        ON CONFLICT (model_name, prompt_hash) DO UPDATE
        SET response = EXCLUDED.response,
            embedding = EXCLUDED.embedding,
            created_by = EXCLUDED.created_by,
            created_at = NOW()
    `;
}
