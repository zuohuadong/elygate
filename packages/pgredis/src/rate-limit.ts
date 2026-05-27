import { indexName, normalizePositiveInteger, quoteQualifiedName, type PgSqlLike } from "./sql";

export interface PgRateLimiterOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface PgRateLimitHitOptions {
  limit?: number;
  windowMs?: number;
  cost?: number;
}

export interface PgRateLimitSchemaOptions {
  unlogged?: boolean;
}

export interface PgRateLimitResult {
  allowed: boolean;
  limit: number;
  count: number;
  remaining: number;
  resetAt: Date;
  retryAfterMs: number;
}

export interface PgSlidingWindowRateLimiterOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
  limit: number;
  windowMs: number;
  precisionMs?: number;
  now?: () => number;
}

export interface PgTokenBucketRateLimiterOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
  capacity: number;
  refillTokens: number;
  refillIntervalMs: number;
  now?: () => number;
}

export interface PgTokenBucketResult {
  allowed: boolean;
  capacity: number;
  tokens: number;
  remaining: number;
  retryAfterMs: number;
}

interface CountRow {
  count: number | string;
}

const DEFAULT_TABLE_NAME = "pg_rate_limit";
const DEFAULT_NAMESPACE = "default";
const DEFAULT_SLIDING_TABLE_NAME = "pg_sliding_rate_limit";
const DEFAULT_TOKEN_BUCKET_TABLE_NAME = "pg_token_bucket_rate_limit";

export class PgFixedWindowRateLimiter {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;
  private readonly now: () => number;
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: PgRateLimiterOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
    this.now = options.now || Date.now;
    this.limit = normalizePositiveInteger(options.limit, "limit");
    this.windowMs = normalizePositiveInteger(options.windowMs, "windowMs");
  }

  async ensureSchema(options: PgRateLimitSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === false ? "" : "UNLOGGED ";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        window_start BIGINT NOT NULL,
        count BIGINT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, key, window_start)
      )
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "expires_at")}
      ON ${this.quotedTableName} (expires_at)
    `);
  }

  async hit(key: string, options: PgRateLimitHitOptions = {}): Promise<PgRateLimitResult> {
    const limit = normalizePositiveInteger(options.limit ?? this.limit, "limit");
    const windowMs = normalizePositiveInteger(options.windowMs ?? this.windowMs, "windowMs");
    const cost = normalizePositiveInteger(options.cost ?? 1, "cost");
    const now = this.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetAtMs = windowStart + windowMs;

    const rows = await this.sql.unsafe<CountRow>(
      `INSERT INTO ${this.quotedTableName} (namespace, key, window_start, count, expires_at, updated_at)
       VALUES (
         $1,
         $2,
         $3,
         $4,
         NOW() + ($5::bigint * INTERVAL '1 millisecond'),
         NOW()
       )
       ON CONFLICT (namespace, key, window_start) DO UPDATE
       SET count = ${this.quotedTableName}.count + EXCLUDED.count,
           expires_at = GREATEST(${this.quotedTableName}.expires_at, EXCLUDED.expires_at),
           updated_at = NOW()
       RETURNING count`,
      [this.namespace, key, windowStart, cost, windowMs]
    );

    const count = Number(rows[0]?.count ?? cost);
    const allowed = count <= limit;
    const retryAfterMs = allowed ? 0 : Math.max(0, resetAtMs - now);
    return {
      allowed,
      limit,
      count,
      remaining: Math.max(0, limit - count),
      resetAt: new Date(resetAtMs),
      retryAfterMs
    };
  }

  async cleanupExpired(limit = 1000): Promise<number> {
    const rows = await this.sql.unsafe<{ key: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE ctid IN (
         SELECT ctid
         FROM ${this.quotedTableName}
         WHERE expires_at <= NOW()
         LIMIT $1
       )
       RETURNING key`,
      [Math.max(1, Math.floor(limit))]
    );
    return rows.length;
  }
}

export function createPgFixedWindowRateLimiter(options: PgRateLimiterOptions): PgFixedWindowRateLimiter {
  return new PgFixedWindowRateLimiter(options);
}

export class PgSlidingWindowRateLimiter {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;
  private readonly now: () => number;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly precisionMs: number;

  constructor(options: PgSlidingWindowRateLimiterOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_SLIDING_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
    this.now = options.now || Date.now;
    this.limit = normalizePositiveInteger(options.limit, "limit");
    this.windowMs = normalizePositiveInteger(options.windowMs, "windowMs");
    this.precisionMs = normalizePositiveInteger(options.precisionMs || 1000, "precisionMs");
  }

  async ensureSchema(options: PgRateLimitSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === false ? "" : "UNLOGGED ";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        bucket_start BIGINT NOT NULL,
        count BIGINT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, key, bucket_start)
      )
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "expires_at")}
      ON ${this.quotedTableName} (expires_at)
    `);
  }

  async hit(key: string, options: PgRateLimitHitOptions = {}): Promise<PgRateLimitResult> {
    const limit = normalizePositiveInteger(options.limit ?? this.limit, "limit");
    const windowMs = normalizePositiveInteger(options.windowMs ?? this.windowMs, "windowMs");
    const cost = normalizePositiveInteger(options.cost ?? 1, "cost");
    const now = this.now();
    const bucketStart = Math.floor(now / this.precisionMs) * this.precisionMs;
    const windowStart = now - windowMs;

    const rows = await this.sql.unsafe<CountRow>(
      `WITH upserted AS (
         INSERT INTO ${this.quotedTableName} (namespace, key, bucket_start, count, expires_at, updated_at)
         VALUES (
           $1,
           $2,
           $3,
           $4,
           NOW() + ($5::bigint * INTERVAL '1 millisecond'),
           NOW()
         )
         ON CONFLICT (namespace, key, bucket_start) DO UPDATE
         SET count = ${this.quotedTableName}.count + EXCLUDED.count,
             expires_at = GREATEST(${this.quotedTableName}.expires_at, EXCLUDED.expires_at),
             updated_at = NOW()
       )
       SELECT COALESCE(SUM(count), 0)::bigint AS count
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND key = $2
         AND bucket_start > $6`,
      [this.namespace, key, bucketStart, cost, windowMs, windowStart]
    );

    const count = Number(rows[0]?.count ?? cost);
    const allowed = count <= limit;
    return {
      allowed,
      limit,
      count,
      remaining: Math.max(0, limit - count),
      resetAt: new Date(bucketStart + windowMs),
      retryAfterMs: allowed ? 0 : this.precisionMs
    };
  }

  async cleanupExpired(limit = 1000): Promise<number> {
    const rows = await this.sql.unsafe<{ key: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE ctid IN (
         SELECT ctid
         FROM ${this.quotedTableName}
         WHERE expires_at <= NOW()
         LIMIT $1
       )
       RETURNING key`,
      [Math.max(1, Math.floor(limit))]
    );
    return rows.length;
  }
}

export class PgTokenBucketRateLimiter {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly refillTokens: number;
  private readonly refillIntervalMs: number;

  constructor(options: PgTokenBucketRateLimiterOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_TOKEN_BUCKET_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
    this.now = options.now || Date.now;
    this.capacity = normalizePositiveInteger(options.capacity, "capacity");
    this.refillTokens = normalizePositiveInteger(options.refillTokens, "refillTokens");
    this.refillIntervalMs = normalizePositiveInteger(options.refillIntervalMs, "refillIntervalMs");
  }

  async ensureSchema(options: PgRateLimitSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === false ? "" : "UNLOGGED ";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        tokens DOUBLE PRECISION NOT NULL,
        last_refill_ms BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, key)
      )
    `);
  }

  async consume(key: string, cost = 1): Promise<PgTokenBucketResult> {
    const normalizedCost = normalizePositiveInteger(cost, "cost");
    const now = this.now();
    const rows = await this.sql.unsafe<{ tokens: number | string; available: number | string; allowed: boolean }>(
      `WITH seeded AS (
         INSERT INTO ${this.quotedTableName} (namespace, key, tokens, last_refill_ms, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (namespace, key) DO NOTHING
       ), state AS (
         SELECT tokens, last_refill_ms
         FROM ${this.quotedTableName}
         WHERE namespace = $1 AND key = $2
         FOR UPDATE
       ), computed AS (
         SELECT LEAST(
           $3::double precision,
           tokens + GREATEST(0, $4::bigint - last_refill_ms)::double precision / $5::double precision * $6::double precision
         ) AS available
         FROM state
       ), updated AS (
         UPDATE ${this.quotedTableName} target
         SET tokens = CASE
               WHEN computed.available >= $7 THEN computed.available - $7
               ELSE computed.available
             END,
             last_refill_ms = $4,
             updated_at = NOW()
         FROM computed
         WHERE target.namespace = $1 AND target.key = $2
         RETURNING target.tokens, computed.available, computed.available >= $7 AS allowed
       )
       SELECT tokens, available, allowed FROM updated`,
      [
        this.namespace,
        key,
        this.capacity,
        now,
        this.refillIntervalMs,
        this.refillTokens,
        normalizedCost
      ]
    );

    const row = rows[0];
    const available = Number(row?.available ?? this.capacity);
    const tokens = Number(row?.tokens ?? Math.max(0, this.capacity - normalizedCost));
    const allowed = !!row?.allowed;
    const retryAfterMs = allowed
      ? 0
      : Math.ceil(Math.max(0, normalizedCost - available) / this.refillTokens * this.refillIntervalMs);

    return {
      allowed,
      capacity: this.capacity,
      tokens,
      remaining: Math.max(0, Math.floor(tokens)),
      retryAfterMs
    };
  }
}

export function createPgSlidingWindowRateLimiter(options: PgSlidingWindowRateLimiterOptions): PgSlidingWindowRateLimiter {
  return new PgSlidingWindowRateLimiter(options);
}

export function createPgTokenBucketRateLimiter(options: PgTokenBucketRateLimiterOptions): PgTokenBucketRateLimiter {
  return new PgTokenBucketRateLimiter(options);
}
