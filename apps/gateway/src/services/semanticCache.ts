import { sql } from '@elygate/db';

const SIMILARITY_THRESHOLD = 0.85; // Cosine similarity threshold
const CACHE_TTL_HOURS = 24;

/**
 * Generates a text embedding vector via an OpenAI-compatible embeddings endpoint.
 * Uses the `nomic-embed-text` model by default, but can be configured.
 */
async function generateEmbedding(text: string, embeddingChannel: any): Promise<number[] | null> {
    const keys = embeddingChannel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
    const activeKey = keys[Math.floor(Math.random() * keys.length)];

    const response = await fetch(`${embeddingChannel.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${activeKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: embeddingChannel.models[0], input: text })
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    return data?.data?.[0]?.embedding ?? null;
}

/**
 * Retrieves a semantically similar cached response for the given query.
 * Returns the cached response if found within the similarity threshold, otherwise null.
 */
export async function lookupSemanticCache(
    prompt: string,
    model: string,
    embeddingChannel: any
): Promise<any | null> {
    const embedding = await generateEmbedding(prompt, embeddingChannel);
    if (!embedding) return null;

    const vectorLiteral = `[${embedding.join(',')}]`;
    const rows = await sql`
        SELECT response, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
        FROM semantic_cache
        WHERE model_name = ${model}
          AND created_at > NOW() - INTERVAL '${sql.unsafe(CACHE_TTL_HOURS.toString())} hours'
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT 1
    `;

    if (rows.length > 0 && rows[0].similarity >= SIMILARITY_THRESHOLD) {
        console.log(`[SemanticCache] HIT! Similarity: ${rows[0].similarity.toFixed(4)}`);
        return rows[0].response;
    }

    return null;
}

/**
 * Stores a new response in the semantic cache for future lookups.
 */
export async function storeSemanticCache(
    prompt: string,
    model: string,
    response: any,
    embeddingChannel: any
): Promise<void> {
    const embedding = await generateEmbedding(prompt, embeddingChannel);
    if (!embedding) return;

    const vectorLiteral = `[${embedding.join(',')}]`;
    await sql`
        INSERT INTO semantic_cache (model_name, prompt_hash, prompt, embedding, response)
        VALUES (${model}, md5(${prompt}), ${prompt}, ${vectorLiteral}::vector, ${JSON.stringify(response)})
        ON CONFLICT (model_name, prompt_hash) DO UPDATE
        SET response = EXCLUDED.response,
            embedding = EXCLUDED.embedding,
            created_at = NOW()
    `;
}
