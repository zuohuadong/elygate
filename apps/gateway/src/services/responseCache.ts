import { log } from '../services/logger';
import { db, sql } from '@elygate/db';
import { responseCache } from '@elygate/db/schema';
import { eq, and, or, isNull, gt, lt, sql as drizzleSql, count } from 'drizzle-orm';
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

    const rows = await db.select()
        .from(responseCache)
        .where(and(
            eq(responseCache.hash, hash),
            or(isNull(responseCache.expiredAt), gt(responseCache.expiredAt, drizzleSql`NOW()`)),
        ))
        .limit(1);

    if (rows.length > 0) {
        log.info('[ResponseCache] HIT!');
        memoryCache.stats.responseCacheHits++;
        
        await db.update(responseCache)
            .set({ lastReadAt: new Date() })
            .where(eq(responseCache.hash, hash));

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

    await db.insert(responseCache).values({
        hash,
        modelName: model,
        response,
        usage,
        createdBy: userId || null,
        expiredAt,
    })
    .onConflictDoUpdate({
        target: responseCache.hash,
        set: {
            response: drizzleSql`EXCLUDED.response`,
            usage: drizzleSql`EXCLUDED.usage`,
            expiredAt: drizzleSql`EXCLUDED.expired_at`,
            createdAt: drizzleSql`NOW()`,
        },
    });
    log.info('[ResponseCache] Stored response for model:', model);
}

export async function clearResponseCache(olderThanHours = 24): Promise<number> {
    const result = await db.delete(responseCache)
        .where(drizzleSql`${responseCache.createdAt} < NOW() - make_interval(hours => ${olderThanHours})`)
        .returning({ hash: responseCache.hash });
    return result.length;
}

export async function getResponseCacheStats(): Promise<{ total: number; expired: number }> {
    const [totalRow] = await db.select({ count: count() }).from(responseCache);
    const [expiredRow] = await db.select({ count: count() }).from(responseCache)
        .where(lt(responseCache.expiredAt, drizzleSql`NOW()`));
    return {
        total: totalRow.count,
        expired: expiredRow.count
    };
}
