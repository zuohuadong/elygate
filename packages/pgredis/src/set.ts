import { indexName, quoteQualifiedName, type PgSqlLike } from "./sql";

export interface PgSetOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
}

export interface PgSetSchemaOptions {
  unlogged?: boolean;
}

export interface PgSetScanResult {
  cursor: string | null;
  members: string[];
}

interface MemberRow {
  member: string;
}

interface CountRow {
  count: number | string;
}

const DEFAULT_TABLE_NAME = "pgredis_set";
const DEFAULT_NAMESPACE = "default";

export class PgSet {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;

  constructor(options: PgSetOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
  }

  async ensureSchema(options: PgSetSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === false ? "" : "UNLOGGED ";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        member TEXT NOT NULL,
        expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, key, member)
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

  async sadd(key: string, ...members: string[]): Promise<number> {
    const values = [...new Set(members)];
    if (values.length === 0) return 0;
    const params: unknown[] = [];
    const groups = values.map((member, index) => {
      const base = index * 3;
      params.push(this.namespace, key, member);
      return `($${base + 1}, $${base + 2}, $${base + 3}, (SELECT MAX(expires_at) FROM ${this.quotedTableName} WHERE namespace = $${base + 1} AND key = $${base + 2}), NOW())`;
    }).join(", ");

    const rows = await this.sql.unsafe<MemberRow>(
      `INSERT INTO ${this.quotedTableName} (namespace, key, member, expires_at, updated_at)
       VALUES ${groups}
       ON CONFLICT (namespace, key, member) DO NOTHING
       RETURNING member`,
      params
    );
    return rows.length;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const values = [...new Set(members)];
    if (values.length === 0) return 0;
    const placeholders = values.map((_, index) => `$${index + 3}`).join(", ");
    const rows = await this.sql.unsafe<MemberRow>(
      `DELETE FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2 AND member IN (${placeholders})
       RETURNING member`,
      [this.namespace, key, ...values]
    );
    return rows.length;
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const rows = await this.sql.unsafe<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ${this.quotedTableName}
         WHERE namespace = $1 AND key = $2 AND member = $3
           AND (expires_at IS NULL OR expires_at > NOW())
       ) AS exists`,
      [this.namespace, key, member]
    );
    return !!rows[0]?.exists;
  }

  async smembers(key: string): Promise<string[]> {
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT member
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY member ASC`,
      [this.namespace, key]
    );
    return rows.map((row) => row.member);
  }

  async sinter(...keys: string[]): Promise<string[]> {
    const values = [...new Set(keys)];
    if (values.length === 0) return [];
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT member
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = ANY($2::text[])
         AND (expires_at IS NULL OR expires_at > NOW())
       GROUP BY member
       HAVING COUNT(DISTINCT key) = $3
       ORDER BY member ASC`,
      [this.namespace, values, values.length]
    );
    return rows.map((row) => row.member);
  }

  async sunion(...keys: string[]): Promise<string[]> {
    const values = [...new Set(keys)];
    if (values.length === 0) return [];
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT DISTINCT member
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = ANY($2::text[])
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY member ASC`,
      [this.namespace, values]
    );
    return rows.map((row) => row.member);
  }

  async sdiff(key: string, ...otherKeys: string[]): Promise<string[]> {
    const values = [...new Set(otherKeys)];
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT member
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (
           $3::text[] = ARRAY[]::text[]
           OR member NOT IN (
             SELECT member
             FROM ${this.quotedTableName}
             WHERE namespace = $1 AND key = ANY($3::text[])
               AND (expires_at IS NULL OR expires_at > NOW())
           )
         )
       ORDER BY member ASC`,
      [this.namespace, key, values]
    );
    return rows.map((row) => row.member);
  }

  async scard(key: string): Promise<number> {
    const rows = await this.sql.unsafe<CountRow>(
      `SELECT COUNT(*)::bigint AS count
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [this.namespace, key]
    );
    return Number(rows[0]?.count ?? 0);
  }

  async sclear(key: string): Promise<number> {
    const rows = await this.sql.unsafe<MemberRow>(
      `DELETE FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
       RETURNING member`,
      [this.namespace, key]
    );
    return rows.length;
  }

  async sscan(key: string, cursor: string | null = null, count = 100): Promise<PgSetScanResult> {
    const limit = Math.max(1, Math.floor(count));
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT member
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND key = $2
         AND member > COALESCE($3::text, '')
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY member ASC
       LIMIT $4`,
      [this.namespace, key, cursor, limit]
    );
    return {
      cursor: rows.length === limit ? rows[rows.length - 1]!.member : null,
      members: rows.map((row) => row.member)
    };
  }

  async expire(key: string, ttlMs: number): Promise<number> {
    const rows = await this.sql.unsafe<{ member: string }>(
      `UPDATE ${this.quotedTableName}
       SET expires_at = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
           updated_at = NOW()
       WHERE namespace = $1 AND key = $2
       RETURNING member`,
      [this.namespace, key, Math.max(0, Math.floor(ttlMs))]
    );
    return rows.length;
  }

  async persist(key: string): Promise<number> {
    const rows = await this.sql.unsafe<{ member: string }>(
      `UPDATE ${this.quotedTableName}
       SET expires_at = NULL,
           updated_at = NOW()
       WHERE namespace = $1 AND key = $2
       RETURNING member`,
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
    const rows = await this.sql.unsafe<{ member: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE ctid IN (
         SELECT ctid
         FROM ${this.quotedTableName}
         WHERE expires_at IS NOT NULL AND expires_at <= NOW()
         LIMIT $1
       )
       RETURNING member`,
      [Math.max(1, Math.floor(limit))]
    );
    return rows.length;
  }
}

export function createPgSet(options: PgSetOptions): PgSet {
  return new PgSet(options);
}
