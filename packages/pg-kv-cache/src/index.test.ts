import { describe, expect, test } from "bun:test";
import { PgKvCache, type BunSqlLike, type PgKvNotification } from "./index";

interface StoredValue {
  value: unknown;
  expiresAt: number | null;
}

class MockSql implements BunSqlLike {
  now = 1_000;
  readonly rows = new Map<string, StoredValue>();
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];
  readonly notifications: PgKvNotification[] = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();

    if (normalized.startsWith("CREATE")) return [] as T[];

    if (normalized.startsWith("SELECT PG_NOTIFY")) {
      this.notifications.push(JSON.parse(String(params[1])) as PgKvNotification);
      return [] as T[];
    }

    if (normalized.startsWith("INSERT INTO")) {
      for (let index = 0; index < params.length; index += 4) {
        const namespace = String(params[index]);
        const key = String(params[index + 1]);
        const value = JSON.parse(String(params[index + 2])) as unknown;
        const ttlMs = params[index + 3] === null ? null : Number(params[index + 3]);
        this.rows.set(this.rowKey(namespace, key), {
          value,
          expiresAt: ttlMs === null ? null : this.now + ttlMs
        });
      }
      return [] as T[];
    }

    if (normalized.startsWith("SELECT VALUE")) {
      const namespace = String(params[0]);
      const key = String(params[1]);
      const row = this.getLiveRow(namespace, key);
      return (row ? [{ value: row.value, expires_at: this.toDate(row.expiresAt) }] : []) as T[];
    }

    if (normalized.startsWith("SELECT KEY, VALUE")) {
      const namespace = String(params[0]);
      const keys = params.slice(1).map(String);
      return keys.flatMap((key) => {
        const row = this.getLiveRow(namespace, key);
        return row ? [{ key, value: row.value, expires_at: this.toDate(row.expiresAt) }] : [];
      }) as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("EXPIRES_AT IS NOT NULL")) {
      const deleted: Array<{ namespace: string; key: string }> = [];
      for (const [compoundKey, row] of this.rows.entries()) {
        if (row.expiresAt !== null && row.expiresAt <= this.now) {
          const [namespace, key] = compoundKey.split("\0");
          this.rows.delete(compoundKey);
          deleted.push({ namespace: namespace!, key: key! });
        }
      }
      return deleted as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("KEY LIKE")) {
      const namespace = String(params[0]);
      const prefix = String(params[1]).replace(/%$/, "").replace(/\\/g, "");
      const deleted: Array<{ key: string }> = [];
      for (const compoundKey of Array.from(this.rows.keys())) {
        const [rowNamespace, key] = compoundKey.split("\0");
        if (rowNamespace === namespace && key!.startsWith(prefix)) {
          this.rows.delete(compoundKey);
          deleted.push({ key: key! });
        }
      }
      return deleted as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("AND KEY =")) {
      const namespace = String(params[0]);
      const key = String(params[1]);
      const deleted = this.rows.delete(this.rowKey(namespace, key));
      return (deleted ? [{ key }] : []) as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("WHERE NAMESPACE =")) {
      const namespace = String(params[0]);
      const deleted: Array<{ key: string }> = [];
      for (const compoundKey of Array.from(this.rows.keys())) {
        const [rowNamespace, key] = compoundKey.split("\0");
        if (rowNamespace === namespace) {
          this.rows.delete(compoundKey);
          deleted.push({ key: key! });
        }
      }
      return deleted as T[];
    }

    throw new Error(`Unhandled SQL: ${query}`);
  }

  private rowKey(namespace: string, key: string): string {
    return `${namespace}\0${key}`;
  }

  private getLiveRow(namespace: string, key: string): StoredValue | null {
    const row = this.rows.get(this.rowKey(namespace, key));
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt <= this.now) return null;
    return row;
  }

  private toDate(expiresAt: number | null): Date | null {
    return expiresAt === null ? null : new Date(expiresAt);
  }
}

describe("PgKvCache", () => {
  test("creates an unlogged schema with ttl and prefix indexes", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, tableName: "public.pg_kv_cache" });

    await cache.ensureSchema();

    expect(sql.queries).toHaveLength(3);
    expect(sql.queries[0]!.query).toContain("CREATE UNLOGGED TABLE");
    expect(sql.queries[1]!.query).toContain("expires_at");
    expect(sql.queries[2]!.query).toContain("text_pattern_ops");
  });

  test("serves fresh values from L1 without reading Postgres again", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", instanceId: "local" });

    await cache.set("token-a", { userId: 1 }, { ttlMs: 60_000 });
    const queryCountAfterSet = sql.queries.length;
    const value = await cache.get<{ userId: number }>("token-a");

    expect(value).toEqual({ userId: 1 });
    expect(sql.queries).toHaveLength(queryCountAfterSet);
    expect(sql.notifications[0]).toMatchObject({ namespace: "auth", key: "token-a", op: "set" });
  });

  test("falls back to Postgres after L1 ttl expires", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", l1: { ttlMs: 10 }, now: () => sql.now });

    await cache.set("token-b", { userId: 2 }, { ttlMs: 1_000 });
    sql.now += 20;

    const value = await cache.get<{ userId: number }>("token-b");

    expect(value).toEqual({ userId: 2 });
    expect(sql.queries.some((entry) => entry.query.includes("SELECT value"))).toBe(true);
  });

  test("returns null for expired L2 rows", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", l1: false, now: () => sql.now });

    await cache.set("token-c", { userId: 3 }, { ttlMs: 5 });
    sql.now += 10;

    await expect(cache.get("token-c")).resolves.toBeNull();
  });

  test("supports mset, mget and prefix clearing", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "models" });

    await cache.mset([
      ["channel:a", { id: 1 }],
      ["channel:b", { id: 2 }],
      ["option:c", { id: 3 }]
    ]);

    const values = await cache.mget<{ id: number }>(["channel:a", "channel:b", "missing"]);
    expect(values.get("channel:a")).toEqual({ id: 1 });
    expect(values.get("channel:b")).toEqual({ id: 2 });
    expect(values.has("missing")).toBe(false);

    await expect(cache.clearPrefix("channel:")).resolves.toBe(2);
    await expect(cache.get("channel:a")).resolves.toBeNull();
    await expect(cache.get("option:c")).resolves.toEqual({ id: 3 });
  });

  test("applies remote invalidation and ignores self notifications", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", instanceId: "local" });

    await cache.set("token-d", { userId: 4 });
    expect(cache.stats().l1Size).toBe(1);

    expect(cache.handleNotification({
      namespace: "auth",
      key: "token-d",
      op: "delete",
      senderId: "remote"
    })).toBe(true);
    expect(cache.stats().l1Size).toBe(0);

    await cache.set("token-d", { userId: 4 });
    expect(cache.handleNotification({
      namespace: "auth",
      key: "token-d",
      op: "delete",
      senderId: "local"
    })).toBe(false);
    expect(cache.stats().l1Size).toBe(1);
  });
});
