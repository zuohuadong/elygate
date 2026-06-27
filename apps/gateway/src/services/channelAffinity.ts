import { log } from './logger';
import { LocalTtlCache } from './localTtlCache';

interface AffinityEntry {
    channelId: number;
    group: string;
    model: string;
    setAt: number;
}

const AFFINITY_TTL_MS = 1000 * 60 * 60;
const affinityCache = new LocalTtlCache<string, AffinityEntry>(100_000, AFFINITY_TTL_MS);

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
    return affinityCache.stats();
}

export function clearAffinityCache(): number {
    const size = affinityCache.size;
    affinityCache.clear();
    log.info(`[Affinity] Cleared ${size} entries`);
    return size;
}
