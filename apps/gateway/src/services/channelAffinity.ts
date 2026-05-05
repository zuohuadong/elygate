import { LRUCache } from 'lru-cache';
import { log } from './logger';

interface AffinityEntry {
    channelId: number;
    group: string;
    model: string;
    setAt: number;
}

const affinityCache = new LRUCache<string, AffinityEntry>({
    max: 100_000,
    ttl: 1000 * 60 * 60, // 1 hour
});

function buildAffinityKey(userId: number, model: string, body: Record<string, any>): string {
    const convId = body.conversation_id || body.metadata?.conversation_id || '';
    return `${userId}:${model}:${convId}`;
}

export function getAffinityChannel(userId: number, model: string, body: Record<string, any>): number | null {
    const key = buildAffinityKey(userId, model, body);
    const entry = affinityCache.get(key);
    if (entry && entry.model === model) {
        return entry.channelId;
    }
    return null;
}

export function setAffinityChannel(userId: number, model: string, body: Record<string, any>, channelId: number, group: string): void {
    const key = buildAffinityKey(userId, model, body);
    affinityCache.set(key, { channelId, group, model, setAt: Date.now() });
}

export function getAffinityStats() {
    return {
        size: affinityCache.size,
        max: affinityCache.max,
        ttlMs: affinityCache.ttl,
    };
}

export function clearAffinityCache(): number {
    const size = affinityCache.size;
    affinityCache.clear();
    log.info(`[Affinity] Cleared ${size} entries`);
    return size;
}
