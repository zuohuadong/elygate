import { indexName, quoteQualifiedName, type PgSqlLike } from "./sql";

export interface PgCounterOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
}

export interface PgCounterSetOptions {
  ttlMs?: number | null;
}

export interface PgCounterSchemaOptions {
  unlogged?: boolean;
}

interface CounterRow {
  value: number | string;
}

const DEFAULT_TABLE_NAME = "pgredis_counter";
const DEFAULT_NAMESPACE = "default";

function normalizeTtlMs(ttlMs: number | null | undefined): number | null {
  if (ttlMs === null || ttlMs === undefined) return null;
  if (!Number.isFinite(ttlMs)) throw new Error(`Invalid ttlMs: ${ttlMs}`);
  return Math.max(0, Math.floor(ttlMs));
}

export class PgCounter {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;

  constructor(options: PgCounterOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
  }

  async ensureSchema(options: PgCounterSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === false ? "" : "UNLOGGED ";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value BIGINT NOT NULL,
        expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, key)
      )
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "expires_at")}
      ON ${this.quotedTableName} (expires_at)
      WHERE expires_at IS NOT NULL
    `);
  }

  async get(key: string): Promise<number | null> {
    const rows = await this.sql.unsafe<CounterRow>(
      `SELECT value
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [this.namespace, key]
    );
    return rows[0] ? Number(rows[0].value) : null;
  }

  async set(key: string, value: number, options: PgCounterSetOptions = {}): Promise<number> {
    if (!Number.isSafeInteger(value)) throw new Error(`Invalid counter value: ${value}`);
    const ttlMs = normalizeTtlMs(options.ttlMs);
    const rows = await this.sql.unsafe<CounterRow>(
      `INSERT INTO ${this.quotedTableName} (namespace, key, value, expires_at, updated_at)
       VALUES (
         $1,
         $2,
         $3,
         CASE WHEN $4::bigint IS NULL THEN NULL ELSE NOW() + ($4::bigint * INTERVAL '1 millisecond') END,
         NOW()
       )
       ON CONFLICT (namespace, key) DO UPDATE
       SET value = EXCLUDED.value,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()
       RETURNING value`,
      [this.namespace, key, Math.trunc(value), ttlMs]
    );
    return Number(rows[0]?.value ?? value);
  }

  async incr(key: string, amount = 1, options: PgCounterSetOptions = {}): Promise<number> {
    if (!Number.isSafeInteger(amount)) throw new Error(`Invalid counter increment: ${amount}`);
    const ttlMs = normalizeTtlMs(options.ttlMs);
    const rows = await this.sql.unsafe<CounterRow>(
      `INSERT INTO ${this.quotedTableName} (namespace, key, value, expires_at, updated_at)
       VALUES (
         $1,
         $2,
         $3,
         CASE WHEN $4::bigint IS NULL THEN NULL ELSE NOW() + ($4::bigint * INTERVAL '1 millisecond') END,
         NOW()
       )
       ON CONFLICT (namespace, key) DO UPDATE
       SET value = CASE
             WHEN ${this.quotedTableName}.expires_at IS NOT NULL AND ${this.quotedTableName}.expires_at <= NOW()
               THEN EXCLUDED.value
             ELSE ${this.quotedTableName}.value + EXCLUDED.value
           END,
           expires_at = COALESCE(EXCLUDED.expires_at, ${this.quotedTableName}.expires_at),
           updated_at = NOW()
       RETURNING value`,
      [this.namespace, key, Math.trunc(amount), ttlMs]
    );
    return Number(rows[0]?.value ?? amount);
  }

  decr(key: string, amount = 1, options: PgCounterSetOptions = {}): Promise<number> {
    return this.incr(key, -Math.abs(amount), options);
  }

  async delete(key: string): Promise<boolean> {
    const rows = await this.sql.unsafe<{ key: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
       RETURNING key`,
      [this.namespace, key]
    );
    return rows.length > 0;
  }

  async cleanupExpired(limit = 1000): Promise<number> {
    const rows = await this.sql.unsafe<{ key: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE ctid IN (
         SELECT ctid
         FROM ${this.quotedTableName}
         WHERE expires_at IS NOT NULL AND expires_at <= NOW()
         LIMIT $1
       )
       RETURNING key`,
      [Math.max(1, Math.floor(limit))]
    );
    return rows.length;
  }
}

export function createPgCounter(options: PgCounterOptions): PgCounter {
  return new PgCounter(options);
}
