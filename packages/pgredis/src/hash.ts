import { indexName, quoteQualifiedName, type PgSqlLike } from "./sql";

export interface PgHashOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
}

export interface PgHashSchemaOptions {
  unlogged?: boolean;
}

export interface PgHashScanResult<T = unknown> {
  cursor: string | null;
  entries: Array<readonly [string, T]>;
}

interface HashRow {
  field: string;
  value: unknown;
}

interface NumberRow {
  value: number | string;
}

const DEFAULT_TABLE_NAME = "pgredis_hash";
const DEFAULT_NAMESPACE = "default";

function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

function parseValue<T>(value: unknown): T {
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

export class PgHash {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;

  constructor(options: PgHashOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
  }

  async ensureSchema(options: PgHashSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === false ? "" : "UNLOGGED ";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        field TEXT NOT NULL,
        value JSONB NOT NULL,
        expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, key, field)
      )
    `);
    await this.sql.unsafe(`
      ALTER TABLE ${this.quotedTableName}
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "namespace_key")}
      ON ${this.quotedTableName} (namespace, key)
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "expires_at")}
      ON ${this.quotedTableName} (expires_at)
      WHERE expires_at IS NOT NULL
    `);
  }

  async hget<T = unknown>(key: string, field: string): Promise<T | null> {
    const rows = await this.sql.unsafe<{ value: unknown }>(
      `SELECT value
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2 AND field = $3
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [this.namespace, key, field]
    );
    return rows[0] ? parseValue<T>(rows[0].value) : null;
  }

  async hset<T = unknown>(key: string, field: string, value: T): Promise<void> {
    await this.sql.unsafe(
      `INSERT INTO ${this.quotedTableName} (namespace, key, field, value, expires_at, updated_at)
       VALUES (
         $1,
         $2,
         $3,
         $4::jsonb,
         (SELECT MAX(expires_at) FROM ${this.quotedTableName} WHERE namespace = $1 AND key = $2),
         NOW()
       )
       ON CONFLICT (namespace, key, field) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()`,
      [this.namespace, key, field, jsonValue(value)]
    );
  }

  async hmset<T = unknown>(key: string, entries: Iterable<readonly [string, T]>): Promise<void> {
    const values = Array.from(entries);
    if (values.length === 0) return;

    const params: unknown[] = [];
    const groups = values.map(([field, value], index) => {
      const base = index * 4;
      params.push(this.namespace, key, field, jsonValue(value));
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, (SELECT MAX(expires_at) FROM ${this.quotedTableName} WHERE namespace = $${base + 1} AND key = $${base + 2}), NOW())`;
    }).join(", ");

    await this.sql.unsafe(
      `INSERT INTO ${this.quotedTableName} (namespace, key, field, value, expires_at, updated_at)
       VALUES ${groups}
       ON CONFLICT (namespace, key, field) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()`,
      params
    );
  }

  async hgetall<T = unknown>(key: string): Promise<Record<string, T>> {
    const rows = await this.sql.unsafe<HashRow>(
      `SELECT field, value
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY field ASC`,
      [this.namespace, key]
    );
    return Object.fromEntries(rows.map((row) => [row.field, parseValue<T>(row.value)]));
  }

  async hdel(key: string, field: string): Promise<boolean> {
    const rows = await this.sql.unsafe<{ field: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2 AND field = $3
       RETURNING field`,
      [this.namespace, key, field]
    );
    return rows.length > 0;
  }

  async hclear(key: string): Promise<number> {
    const rows = await this.sql.unsafe<{ field: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
       RETURNING field`,
      [this.namespace, key]
    );
    return rows.length;
  }

  async hexists(key: string, field: string): Promise<boolean> {
    const rows = await this.sql.unsafe<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ${this.quotedTableName}
         WHERE namespace = $1 AND key = $2 AND field = $3
           AND (expires_at IS NULL OR expires_at > NOW())
       ) AS exists`,
      [this.namespace, key, field]
    );
    return !!rows[0]?.exists;
  }

  async hlen(key: string): Promise<number> {
    const rows = await this.sql.unsafe<NumberRow>(
      `SELECT COUNT(*)::bigint AS value
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [this.namespace, key]
    );
    return Number(rows[0]?.value ?? 0);
  }

  async hincrby(key: string, field: string, amount = 1): Promise<number> {
    if (!Number.isSafeInteger(amount)) throw new Error(`Invalid hash increment: ${amount}`);
    const rows = await this.sql.unsafe<NumberRow>(
      `INSERT INTO ${this.quotedTableName} (namespace, key, field, value, expires_at, updated_at)
       VALUES (
         $1,
         $2,
         $3,
         to_jsonb($4::bigint),
         (SELECT MAX(expires_at) FROM ${this.quotedTableName} WHERE namespace = $1 AND key = $2),
         NOW()
       )
       ON CONFLICT (namespace, key, field) DO UPDATE
       SET value = to_jsonb(((${this.quotedTableName}.value #>> '{}')::bigint + $4::bigint)),
           updated_at = NOW()
       RETURNING (value #>> '{}')::bigint AS value`,
      [this.namespace, key, field, Math.trunc(amount)]
    );
    return Number(rows[0]?.value ?? amount);
  }

  async hscan<T = unknown>(key: string, cursor: string | null = null, count = 100): Promise<PgHashScanResult<T>> {
    const rows = await this.sql.unsafe<HashRow>(
      `SELECT field, value
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND key = $2
         AND field > COALESCE($3::text, '')
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY field ASC
       LIMIT $4`,
      [this.namespace, key, cursor, Math.max(1, Math.floor(count))]
    );
    return {
      cursor: rows.length === count ? rows[rows.length - 1]!.field : null,
      entries: rows.map((row) => [row.field, parseValue<T>(row.value)] as const)
    };
  }

  async expire(key: string, ttlMs: number): Promise<number> {
    const rows = await this.sql.unsafe<{ field: string }>(
      `UPDATE ${this.quotedTableName}
       SET expires_at = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
           updated_at = NOW()
       WHERE namespace = $1 AND key = $2
       RETURNING field`,
      [this.namespace, key, Math.max(0, Math.floor(ttlMs))]
    );
    return rows.length;
  }

  async persist(key: string): Promise<number> {
    const rows = await this.sql.unsafe<{ field: string }>(
      `UPDATE ${this.quotedTableName}
       SET expires_at = NULL,
           updated_at = NOW()
       WHERE namespace = $1 AND key = $2
       RETURNING field`,
      [this.namespace, key]
    );
    return rows.length;
  }

  async ttl(key: string): Promise<number | null> {
    const rows = await this.sql.unsafe<{ ttl_ms: number | string | null }>(
      `SELECT CASE
         WHEN MAX(expires_at) IS NULL THEN NULL
         ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (MAX(expires_at) - NOW())) * 1000))::bigint
       END AS ttl_ms
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2`,
      [this.namespace, key]
    );
    return rows[0]?.ttl_ms === null || rows[0]?.ttl_ms === undefined ? null : Number(rows[0].ttl_ms);
  }

  async cleanupExpired(limit = 1000): Promise<number> {
    const rows = await this.sql.unsafe<{ field: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE ctid IN (
         SELECT ctid
         FROM ${this.quotedTableName}
         WHERE expires_at IS NOT NULL AND expires_at <= NOW()
         LIMIT $1
       )
       RETURNING field`,
      [Math.max(1, Math.floor(limit))]
    );
    return rows.length;
  }
}

export function createPgHash(options: PgHashOptions): PgHash {
  return new PgHash(options);
}
