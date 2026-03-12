import { sql } from '@elygate/db';
import { optionCache } from './optionCache';

const DEFAULT_CACHE_TTL_HOURS = 24;

export async function lookupExactCache(
    messages: any[],
    model: string,
    userId?: number,
    policy?: any
): Promise<any | null> {
    // Basic checks
    const globalEnabled = optionCache.get('ResponseCacheEnabled', 'true') === 'true';
    if (!globalEnabled || policy?.mode === 'disabled') return null;

    // Calculate hash: model + JSON stringified messages
    const input = JSON.stringify({ model, messages });
    const hash = new Bun.CryptoHasher('sha256').update(input).digest('hex');

    // Policy: Isolated mode (only hits cache created by this user)
    const isolationClause = (policy?.mode === 'isolated' && userId) 
        ? sql`AND created_by = ${userId}` 
        : sql``;

    // Policy: Smart Refresh (same as semantic cache logic)
    const smartClause = (policy?.mode === 'smart' && userId)
        ? sql`AND (created_by != ${userId} OR created_at > NOW() - INTERVAL '2 minutes')`
        : sql``;

    const [row] = await sql`
        SELECT response, usage
        FROM response_cache
        WHERE hash = ${hash}
          AND model_name = ${model}
          AND created_at > NOW() - make_interval(hours => ${optionCache.get('SemanticCacheTTLHours', DEFAULT_CACHE_TTL_HOURS)})
          ${isolationClause}
          ${smartClause}
        LIMIT 1
    `;

    if (row) {
        console.log(`[ResponseCache] EXACT HIT! Hash: ${hash.substring(0, 8)}`);
        return row.response;
    }

    return null;
}

export async function storeExactCache(
    messages: any[],
    model: string,
    response: any,
    createdBy?: number,
    policy?: any
): Promise<void> {
    const globalEnabled = optionCache.get('ResponseCacheEnabled', 'true') === 'true';
    if (!globalEnabled || policy?.mode === 'disabled') return;

    const input = JSON.stringify({ model, messages });
    const hash = new Bun.CryptoHasher('sha256').update(input).digest('hex');

    await sql`
        INSERT INTO response_cache (hash, model_name, response, usage, created_by)
        VALUES (${hash}, ${model}, ${JSON.stringify(response)}, ${JSON.stringify(response.usage || null)}, ${createdBy || null})
        ON CONFLICT (hash) DO UPDATE
        SET response = EXCLUDED.response,
            usage = EXCLUDED.usage,
            created_by = EXCLUDED.created_by,
            created_at = NOW()
    `;
    console.log(`[ResponseCache] Stored hash: ${hash.substring(0, 8)} for model: ${model}`);
}
