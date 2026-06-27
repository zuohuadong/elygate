import { describe, expect, test } from 'bun:test';
import { LocalTtlCache } from './localTtlCache';

describe('LocalTtlCache', () => {
    test('expires entries by ttl and prunes them from stats', () => {
        let now = 1_000;
        const cache = new LocalTtlCache<string, number>(10, 100, () => now);

        cache.set('a', 1);
        expect(cache.get('a')).toBe(1);

        now = 1_101;

        expect(cache.get('a')).toBeUndefined();
        expect(cache.stats()).toEqual({ size: 0, max: 10, ttlMs: 100 });
    });

    test('evicts the oldest entry when max size is exceeded', () => {
        let now = 1_000;
        const cache = new LocalTtlCache<string, number>(2, 1_000, () => now);

        cache.set('a', 1);
        now += 1;
        cache.set('b', 2);
        now += 1;
        cache.get('a');
        now += 1;
        cache.set('c', 3);

        expect(cache.get('a')).toBe(1);
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('c')).toBe(3);
        expect(cache.size).toBe(2);
    });

    test('clear removes all local derived cache entries', () => {
        const cache = new LocalTtlCache<string, string>(3, 1_000);

        cache.set('first', 'one');
        cache.set('second', 'two');
        cache.clear();

        expect(cache.get('first')).toBeUndefined();
        expect(cache.get('second')).toBeUndefined();
        expect(cache.size).toBe(0);
    });
});
