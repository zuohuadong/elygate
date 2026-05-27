import { indexName, quoteQualifiedName, type PgSqlLike } from "./sql";

export interface PgSortedSetOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
}

export interface PgSortedSetSchemaOptions {
  unlogged?: boolean;
}

export interface PgSortedSetMember {
  member: string;
  score: number;
}

export interface PgSortedSetScanResult {
  cursor: string | null;
  entries: PgSortedSetMember[];
}

interface MemberRow {
  member: string;
  score: number | string;
}

interface CountRow {
  count: number | string;
}

const DEFAULT_TABLE_NAME = "pgredis_sorted_set";
const DEFAULT_NAMESPACE = "default";

export class PgSortedSet {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;

  constructor(options: PgSortedSetOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
  }

  async ensureSchema(options: PgSortedSetSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === false ? "" : "UNLOGGED ";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        member TEXT NOT NULL,
        score DOUBLE PRECISION NOT NULL,
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
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "score")}
      ON ${this.quotedTableName} (namespace, key, score ASC, member ASC)
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "expires_at")}
      ON ${this.quotedTableName} (expires_at)
      WHERE expires_at IS NOT NULL
    `);
  }

  async zadd(key: string, score: number, member: string): Promise<boolean> {
    if (!Number.isFinite(score)) throw new Error(`Invalid sorted-set score: ${score}`);
    const rows = await this.sql.unsafe<{ inserted: number }>(
      `INSERT INTO ${this.quotedTableName} (namespace, key, member, score, expires_at, updated_at)
       VALUES (
         $1,
         $2,
         $3,
         $4,
         (SELECT MAX(expires_at) FROM ${this.quotedTableName} WHERE namespace = $1 AND key = $2),
         NOW()
       )
       ON CONFLICT (namespace, key, member) DO UPDATE
       SET score = EXCLUDED.score,
           updated_at = NOW()
       RETURNING (xmax = 0)::int AS inserted`,
      [this.namespace, key, member, score]
    );
    return Number(rows[0]?.inserted ?? 0) === 1;
  }

  async zscore(key: string, member: string): Promise<number | null> {
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT score
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2 AND member = $3
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [this.namespace, key, member]
    );
    return rows[0] ? Number(rows[0].score) : null;
  }

  async zrange(key: string, start = 0, stop = -1, options: { withScores?: boolean; desc?: boolean } = {}): Promise<string[] | PgSortedSetMember[]> {
    const limit = stop < 0 ? null : Math.max(0, stop - start + 1);
    const order = options.desc ? "DESC" : "ASC";
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT member, score
       FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY score ${order}, member ${order}
       OFFSET $3
       LIMIT COALESCE($4::bigint, 9223372036854775807)`,
      [this.namespace, key, Math.max(0, start), limit]
    );
    if (options.withScores) {
      return rows.map((row) => ({ member: row.member, score: Number(row.score) }));
    }
    return rows.map((row) => row.member);
  }

  async zrangeByScore(
    key: string,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    options: { withScores?: boolean; limit?: number; offset?: number; desc?: boolean } = {}
  ): Promise<string[] | PgSortedSetMember[]> {
    const order = options.desc ? "DESC" : "ASC";
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT member, score
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND key = $2
         AND score >= $3
         AND score <= $4
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY score ${order}, member ${order}
       OFFSET $5
       LIMIT COALESCE($6::bigint, 9223372036854775807)`,
      [
        this.namespace,
        key,
        min,
        max,
        Math.max(0, options.offset || 0),
        options.limit === undefined ? null : Math.max(0, Math.floor(options.limit))
      ]
    );
    if (options.withScores) {
      return rows.map((row) => ({ member: row.member, score: Number(row.score) }));
    }
    return rows.map((row) => row.member);
  }

  async zrank(key: string, member: string, options: { desc?: boolean } = {}): Promise<number | null> {
    const comparator = options.desc
      ? "(candidate.score > target.score OR (candidate.score = target.score AND candidate.member > target.member))"
      : "(candidate.score < target.score OR (candidate.score = target.score AND candidate.member < target.member))";
    const rows = await this.sql.unsafe<CountRow>(
      `WITH target AS (
         SELECT score, member
         FROM ${this.quotedTableName}
         WHERE namespace = $1 AND key = $2 AND member = $3
           AND (expires_at IS NULL OR expires_at > NOW())
       )
       SELECT CASE
         WHEN EXISTS (SELECT 1 FROM target) THEN COUNT(candidate.member)::bigint
         ELSE NULL
       END AS count
       FROM target
       JOIN ${this.quotedTableName} candidate
         ON candidate.namespace = $1
        AND candidate.key = $2
        AND (candidate.expires_at IS NULL OR candidate.expires_at > NOW())
        AND ${comparator}`,
      [this.namespace, key, member]
    );
    if (rows.length === 0 || rows[0]?.count === null || rows[0]?.count === undefined) return null;
    return Number(rows[0].count);
  }

  async zcount(key: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): Promise<number> {
    const rows = await this.sql.unsafe<CountRow>(
      `SELECT COUNT(*)::bigint AS count
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND key = $2
         AND score >= $3
         AND score <= $4
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [this.namespace, key, min, max]
    );
    return Number(rows[0]?.count ?? 0);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const values = [...new Set(members)];
    if (values.length === 0) return 0;
    const placeholders = values.map((_, index) => `$${index + 3}`).join(", ");
    const rows = await this.sql.unsafe<{ member: string }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE namespace = $1 AND key = $2 AND member IN (${placeholders})
       RETURNING member`,
      [this.namespace, key, ...values]
    );
    return rows.length;
  }

  async zpopmin(key: string, count = 1): Promise<PgSortedSetMember[]> {
    const rows = await this.sql.unsafe<MemberRow>(
      `DELETE FROM ${this.quotedTableName}
       WHERE (namespace, key, member) IN (
         SELECT namespace, key, member
         FROM ${this.quotedTableName}
         WHERE namespace = $1 AND key = $2
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY score ASC, member ASC
         LIMIT $3
       )
       RETURNING member, score`,
      [this.namespace, key, Math.max(1, Math.floor(count))]
    );
    return rows.map((row) => ({ member: row.member, score: Number(row.score) }));
  }

  async zscan(key: string, cursor: string | null = null, count = 100): Promise<PgSortedSetScanResult> {
    const limit = Math.max(1, Math.floor(count));
    const rows = await this.sql.unsafe<MemberRow>(
      `SELECT member, score
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
      entries: rows.map((row) => ({ member: row.member, score: Number(row.score) }))
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

export function createPgSortedSet(options: PgSortedSetOptions): PgSortedSet {
  return new PgSortedSet(options);
}
