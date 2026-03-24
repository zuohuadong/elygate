import { log } from '../services/logger';
import { sql } from '@elygate/db';
import { optionCache } from './optionCache';
import { memoryCache } from './cache';

const DEFAULT_ENABLED = true;
const DEFAULT_TTL_HOURS = 24;

interface ResponseCacheConfig {
    enabled: boolean;
    ttlHours: number;
}

function getConfig(): ResponseCacheConfig {
    return {
        enabled: optionCache.get('ResponseCacheEnabled', DEFAULT_ENABLED),
        ttlHours: optionCache.get('ResponseCacheTTLHours', DEFAULT_TTL_HOURS)
    };
}

function generateHash(model: string, messages: Record<string, any>[][]): string {
    const content = JSON.stringify({ model, messages });
    return new Bun.CryptoHasher('sha256').update(content).digest('hex');
}

export async function lookupResponseCache(
    model: string,
    messages: Record<string, any>[][],
    userId?: number
): Promise<any | null> {
    const config = getConfig();
    if (!config.enabled) return null;

    const hash = generateHash(model, messages);

    const rows = await sql`
        SELECT response, usage, created_at
        FROM response_cache
        WHERE hash = ${hash}
          AND (expired_at IS NULL OR expired_at > NOW())
        LIMIT 1
    `;

    if (rows.length > 0) {
        log.info('[ResponseCache] HIT!');
        memoryCache.stats.responseCacheHits++;
        
        await sql`
            UPDATE response_cache
            SET last_read_at = NOW()
            WHERE hash = ${hash}
        `;

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

    memoryCache.stats.responseCacheMisses++;
    log.info('[ResponseCache] MISS');
    return null;
}

export async function storeResponseCache(
    model: string,
    messages: Record<string, any>[][],
    response: Record<string, any>,
    usage: Record<string, any>,
    userId?: number
): Promise<void> {
    const config = getConfig();
    if (!config.enabled) return;

    const hash = generateHash(model, messages);
    const expiredAt = new Date(Date.now() + config.ttlHours * 60 * 60 * 1000);

    await sql`
        INSERT INTO response_cache (hash, model_name, response, usage, created_by, expired_at)
        VALUES (${hash}, ${model}, ${response}, ${usage}, ${userId || null}, ${expiredAt})
        ON CONFLICT (hash) DO UPDATE
        SET response = EXCLUDED.response,
            usage = EXCLUDED.usage,
            expired_at = EXCLUDED.expired_at,
            created_at = NOW()
    `;
    log.info('[ResponseCache] Stored response for model:', model);
}

export async function clearResponseCache(olderThanHours = 24): Promise<number> {
    const result = await sql`
        DELETE FROM response_cache 
        WHERE created_at < NOW() - make_interval(hours => ${olderThanHours})
    `;
    return result.length;
}

export async function getResponseCacheStats(): Promise<{ total: number; expired: number }> {
    const total = await sql`SELECT COUNT(*) as count FROM response_cache`;
    const expired = await sql`SELECT COUNT(*) as count FROM response_cache WHERE expired_at < NOW()`;
    return {
        total: total[0].count,
        expired: expired[0].count
    };
}
