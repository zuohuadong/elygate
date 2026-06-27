type LocalTtlCacheEntry<V> = {
    value: V;
    expiresAt: number;
};

export class LocalTtlCache<K, V> {
    private readonly entries = new Map<K, LocalTtlCacheEntry<V>>();

    constructor(
        private readonly max: number,
        private readonly ttlMs: number,
        private readonly now: () => number = Date.now,
    ) {}

    get size(): number {
        this.pruneExpired();
        return this.entries.size;
    }

    get(key: K): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(key);
            return undefined;
        }

        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key: K, value: V): void {
        this.entries.delete(key);
        this.entries.set(key, {
            value,
            expiresAt: this.ttlMs > 0 ? this.now() + this.ttlMs : Number.POSITIVE_INFINITY,
        });
        this.enforceMax();
    }

    delete(key: K): boolean {
        return this.entries.delete(key);
    }

    clear(): void {
        this.entries.clear();
    }

    stats(): { size: number; max: number; ttlMs: number } {
        return {
            size: this.size,
            max: this.max,
            ttlMs: this.ttlMs,
        };
    }

    private pruneExpired(): void {
        const now = this.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(key);
        }
    }

    private enforceMax(): void {
        this.pruneExpired();
        while (this.entries.size > this.max) {
            const oldest = this.entries.keys().next();
            if (oldest.done) return;
            this.entries.delete(oldest.value);
        }
    }
}
