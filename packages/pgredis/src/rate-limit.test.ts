import { describe, expect, test } from "bun:test";
import { PgFixedWindowRateLimiter, PgSlidingWindowRateLimiter, PgTokenBucketRateLimiter } from "./rate-limit";
import type { PgSqlLike } from "./sql";

class MockSql implements PgSqlLike {
  readonly counts = new Map<string, number>();
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("INSERT INTO")) {
      const compoundKey = `${String(params[0])}:${String(params[1])}:${String(params[2])}`;
      const nextCount = (this.counts.get(compoundKey) || 0) + Number(params[3]);
      this.counts.set(compoundKey, nextCount);
      return [{ count: nextCount }] as T[];
    }
    if (normalized.startsWith("DELETE FROM")) {
      return [{ key: "old" }] as T[];
    }
    throw new Error(`Unhandled SQL: ${query}`);
  }
}

class SlidingSql implements PgSqlLike {
  count = 0;

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("WITH UPSERTED")) {
      this.count += Number(params[3]);
      return [{ count: this.count }] as T[];
    }
    if (normalized.startsWith("DELETE FROM")) return [] as T[];
    throw new Error(`Unhandled SQL: ${query}`);
  }
}

class TokenBucketSql implements PgSqlLike {
  tokens = 0;
  initialized = false;

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("WITH SEEDED")) {
      const capacity = Number(params[2]);
      const cost = Number(params[6]);
      if (!this.initialized) {
        this.tokens = capacity;
        this.initialized = true;
      }
      const available = this.tokens;
      const allowed = available >= cost;
      if (allowed) this.tokens = available - cost;
      return [{ tokens: this.tokens, available, allowed }] as T[];
    }
    throw new Error(`Unhandled SQL: ${query}`);
  }
}

describe("PgFixedWindowRateLimiter", () => {
  test("creates schema and ttl index", async () => {
    const sql = new MockSql();
    const limiter = new PgFixedWindowRateLimiter({
      sql,
      tableName: "public.pg_rate_limit",
      limit: 2,
      windowMs: 1000
    });

    await limiter.ensureSchema();

    expect(sql.queries).toHaveLength(2);
    expect(sql.queries[0]!.query).toContain("CREATE UNLOGGED TABLE");
    expect(sql.queries[1]!.query).toContain("expires_at");
  });

  test("returns allowed, remaining and retry metadata", async () => {
    const sql = new MockSql();
    const limiter = new PgFixedWindowRateLimiter({
      sql,
      namespace: "api",
      limit: 2,
      windowMs: 1000,
      now: () => 1234
    });

    await expect(limiter.hit("user:1")).resolves.toMatchObject({
      allowed: true,
      count: 1,
      remaining: 1,
      retryAfterMs: 0
    });

    await expect(limiter.hit("user:1")).resolves.toMatchObject({
      allowed: true,
      count: 2,
      remaining: 0,
      retryAfterMs: 0
    });

    await expect(limiter.hit("user:1")).resolves.toMatchObject({
      allowed: false,
      count: 3,
      remaining: 0,
      retryAfterMs: 766
    });
  });

  test("cleans up expired rows", async () => {
    const sql = new MockSql();
    const limiter = new PgFixedWindowRateLimiter({ sql, limit: 1, windowMs: 1000 });

    await expect(limiter.cleanupExpired()).resolves.toBe(1);
  });

  test("sliding-window limiter counts attempts inside a moving window", async () => {
    const limiter = new PgSlidingWindowRateLimiter({
      sql: new SlidingSql(),
      limit: 2,
      windowMs: 10_000,
      precisionMs: 1000,
      now: () => 20_000
    });

    await expect(limiter.hit("user:1")).resolves.toMatchObject({ allowed: true, count: 1 });
    await expect(limiter.hit("user:1")).resolves.toMatchObject({ allowed: true, count: 2 });
    await expect(limiter.hit("user:1")).resolves.toMatchObject({ allowed: false, count: 3 });
  });

  test("token-bucket limiter consumes available tokens", async () => {
    const limiter = new PgTokenBucketRateLimiter({
      sql: new TokenBucketSql(),
      capacity: 2,
      refillTokens: 1,
      refillIntervalMs: 1000,
      now: () => 10_000
    });

    await expect(limiter.consume("user:1")).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.consume("user:1")).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(limiter.consume("user:1")).resolves.toMatchObject({ allowed: false, retryAfterMs: 1000 });
  });
});
