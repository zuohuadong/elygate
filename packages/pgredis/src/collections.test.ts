import { describe, expect, test } from "bun:test";
import { PgCounter } from "./counter";
import { PgHash } from "./hash";
import { PgList } from "./list";
import { PgSet } from "./set";
import { PgSortedSet } from "./sorted-set";
import type { PgSqlLike } from "./sql";

class CounterSql implements PgSqlLike {
  value: number | null = null;

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("SELECT VALUE")) {
      return (this.value === null ? [] : [{ value: this.value }]) as T[];
    }
    if (normalized.startsWith("INSERT INTO")) {
      const amount = Number(params[2]);
      this.value = query.includes(".value + EXCLUDED.value") ? (this.value ?? 0) + amount : amount;
      return [{ value: this.value }] as T[];
    }
    if (normalized.startsWith("DELETE FROM")) {
      const deleted = this.value !== null;
      this.value = null;
      return (deleted ? [{ key: "counter" }] : []) as T[];
    }
    throw new Error(`Unhandled SQL: ${query}`);
  }
}

class HashSql implements PgSqlLike {
  readonly values = new Map<string, unknown>();

  private rowKey(key: unknown, field: unknown): string {
    return `${String(key)}\0${String(field)}`;
  }

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("INSERT INTO") && query.includes("to_jsonb")) {
      const compoundKey = this.rowKey(params[1], params[2]);
      const next = Number(this.values.get(compoundKey) ?? 0) + Number(params[3]);
      this.values.set(compoundKey, next);
      return [{ value: next }] as T[];
    }
    if (normalized.startsWith("INSERT INTO")) {
      const fieldCount = params.length / 4;
      for (let index = 0; index < fieldCount; index++) {
        const base = index * 4;
        this.values.set(this.rowKey(params[base + 1], params[base + 2]), JSON.parse(String(params[base + 3])));
      }
      return [] as T[];
    }
    if (normalized.startsWith("SELECT FIELD")) {
      return Array.from(this.values.entries()).map(([compoundKey, value]) => {
        const [, field] = compoundKey.split("\0");
        return { field, value };
      }) as T[];
    }
    if (normalized.startsWith("SELECT VALUE")) {
      const value = this.values.get(this.rowKey(params[1], params[2]));
      return (value === undefined ? [] : [{ value }]) as T[];
    }
    if (normalized.startsWith("DELETE FROM")) {
      const deleted = this.values.delete(this.rowKey(params[1], params[2]));
      return (deleted ? [{ field: params[2] }] : []) as T[];
    }
    if (normalized.startsWith("SELECT COUNT")) {
      return [{ value: this.values.size }] as T[];
    }
    if (normalized.startsWith("SELECT EXISTS")) {
      return [{ exists: this.values.has(this.rowKey(params[1], params[2])) }] as T[];
    }
    throw new Error(`Unhandled SQL: ${query}`);
  }
}

class SetSql implements PgSqlLike {
  readonly sets = new Map<string, Set<string>>();

  private getSet(key: string): Set<string> {
    const existing = this.sets.get(key);
    if (existing) return existing;
    const next = new Set<string>();
    this.sets.set(key, next);
    return next;
  }

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("INSERT INTO")) {
      const inserted: Array<{ member: string }> = [];
      for (let index = 2; index < params.length; index += 3) {
        const key = String(params[index - 1]);
        const member = String(params[index]);
        const set = this.getSet(key);
        if (!set.has(member)) {
          set.add(member);
          inserted.push({ member });
        }
      }
      return inserted as T[];
    }
    if (normalized.startsWith("DELETE FROM")) {
      const deleted: Array<{ member: string }> = [];
      const set = this.getSet(String(params[1]));
      for (const member of params.slice(2).map(String)) {
        if (set.delete(member)) deleted.push({ member });
      }
      return deleted as T[];
    }
    if (normalized.includes("COUNT(DISTINCT KEY)")) {
      const keys = params[1] as string[];
      const common = [...this.getSet(keys[0] || "")].filter((member) =>
        keys.every((key) => this.getSet(key).has(member))
      );
      return common.sort().map((member) => ({ member })) as T[];
    }
    if (normalized.startsWith("SELECT DISTINCT MEMBER")) {
      const keys = params[1] as string[];
      const all = new Set<string>();
      for (const key of keys) for (const member of this.getSet(key)) all.add(member);
      return [...all].sort().map((member) => ({ member })) as T[];
    }
    if (normalized.includes("MEMBER NOT IN")) {
      const base = this.getSet(String(params[1]));
      const otherKeys = params[2] as string[];
      const diff = [...base].filter((member) => !otherKeys.some((key) => this.getSet(key).has(member)));
      return diff.sort().map((member) => ({ member })) as T[];
    }
    if (normalized.startsWith("SELECT MEMBER")) {
      return Array.from(this.getSet(String(params[1]))).sort().map((member) => ({ member })) as T[];
    }
    if (normalized.startsWith("SELECT COUNT")) {
      return [{ count: this.getSet(String(params[1])).size }] as T[];
    }
    if (normalized.startsWith("SELECT EXISTS")) {
      return [{ exists: this.getSet(String(params[1])).has(String(params[2])) }] as T[];
    }
    throw new Error(`Unhandled SQL: ${query}`);
  }
}

class SortedSetSql implements PgSqlLike {
  readonly scores = new Map<string, number>();

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("INSERT INTO")) {
      const inserted = this.scores.has(String(params[2])) ? 0 : 1;
      this.scores.set(String(params[2]), Number(params[3]));
      return [{ inserted }] as T[];
    }
    if (normalized.startsWith("SELECT SCORE")) {
      const score = this.scores.get(String(params[2]));
      return (score === undefined ? [] : [{ score }]) as T[];
    }
    if (normalized.startsWith("SELECT MEMBER")) {
      const rows = Array.from(this.scores.entries())
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([member, score]) => ({ member, score }));
      return rows as T[];
    }
    if (normalized.startsWith("SELECT COUNT")) {
      const min = Number(params[2]);
      const max = Number(params[3]);
      const count = Array.from(this.scores.values()).filter((score) => score >= min && score <= max).length;
      return [{ count }] as T[];
    }
    if (normalized.startsWith("WITH TARGET")) {
      const member = String(params[2]);
      const score = this.scores.get(member);
      if (score === undefined) return [] as T[];
      const rank = Array.from(this.scores.entries())
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .findIndex(([item]) => item === member);
      return [{ count: rank }] as T[];
    }
    if (normalized.startsWith("DELETE FROM")) {
      const rows = Array.from(this.scores.entries())
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .slice(0, Number(params[2]))
        .map(([member, score]) => {
          this.scores.delete(member);
          return { member, score };
        });
      return rows as T[];
    }
    throw new Error(`Unhandled SQL: ${query}`);
  }
}

class ListSql implements PgSqlLike {
  private id = 0;
  readonly rows: Array<{ id: number; value: unknown; position: number }> = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("INSERT INTO")) {
      for (let index = 2; index < params.length; index += 4) {
        this.rows.push({
          id: ++this.id,
          position: Number(params[index]),
          value: JSON.parse(String(params[index + 1]))
        });
      }
      return [] as T[];
    }
    if (normalized.startsWith("SELECT COUNT")) {
      return [{ count: this.rows.length }] as T[];
    }
    if (normalized.startsWith("SELECT VALUE")) {
      return this.sorted("ASC").map((row) => ({ value: row.value })) as T[];
    }
    if (normalized.startsWith("WITH PICKED")) {
      const direction = normalized.includes("POSITION DESC") ? "DESC" : "ASC";
      const picked = this.sorted(direction).slice(0, Number(params[2]));
      for (const row of picked) {
        const index = this.rows.findIndex((candidate) => candidate.id === row.id);
        if (index >= 0) this.rows.splice(index, 1);
      }
      return picked.map((row) => ({ value: row.value })) as T[];
    }
    if (normalized.startsWith("DELETE FROM")) {
      const deleted = this.rows.splice(0, this.rows.length);
      return deleted.map((row) => ({ id: row.id })) as T[];
    }
    throw new Error(`Unhandled SQL: ${query}`);
  }

  private sorted(direction: "ASC" | "DESC") {
    return [...this.rows].sort((a, b) => {
      const value = a.position - b.position || a.id - b.id;
      return direction === "ASC" ? value : -value;
    });
  }
}

describe("collection primitives", () => {
  test("counter supports set, incr, decr, get and delete", async () => {
    const counter = new PgCounter({ sql: new CounterSql() });

    await expect(counter.set("hits", 10)).resolves.toBe(10);
    await expect(counter.incr("hits", 2)).resolves.toBe(12);
    await expect(counter.decr("hits", 5)).resolves.toBe(7);
    await expect(counter.get("hits")).resolves.toBe(7);
    await expect(counter.delete("hits")).resolves.toBe(true);
    await expect(counter.get("hits")).resolves.toBeNull();
  });

  test("hash supports field set, getall and numeric increment", async () => {
    const hash = new PgHash({ sql: new HashSql() });

    await hash.hset("session:1", "userId", 42);
    await hash.hmset("session:1", [["role", "admin"]]);
    await expect(hash.hget("session:1", "userId")).resolves.toBe(42);
    await expect(hash.hincrby("session:1", "visits", 3)).resolves.toBe(3);
    await expect(hash.hgetall("session:1")).resolves.toMatchObject({
      userId: 42,
      role: "admin",
      visits: 3
    });
  });

  test("set supports add, membership, list and remove", async () => {
    const set = new PgSet({ sql: new SetSql() });

    await expect(set.sadd("online", "a", "b", "a")).resolves.toBe(2);
    await expect(set.sismember("online", "a")).resolves.toBe(true);
    await expect(set.smembers("online")).resolves.toEqual(["a", "b"]);
    await expect(set.scard("online")).resolves.toBe(2);
    await expect(set.srem("online", "a", "missing")).resolves.toBe(1);
  });

  test("set supports intersection, union and difference", async () => {
    const set = new PgSet({ sql: new SetSql() });

    await set.sadd("a", "1", "2");
    await set.sadd("b", "2", "3");

    await expect(set.sinter("a", "b")).resolves.toEqual(["2"]);
    await expect(set.sunion("a", "b")).resolves.toEqual(["1", "2", "3"]);
    await expect(set.sdiff("a", "b")).resolves.toEqual(["1"]);
  });

  test("sorted set supports score, range and pop-min", async () => {
    const sortedSet = new PgSortedSet({ sql: new SortedSetSql() });

    await expect(sortedSet.zadd("rank", 2, "b")).resolves.toBe(true);
    await expect(sortedSet.zadd("rank", 1, "a")).resolves.toBe(true);
    await expect(sortedSet.zscore("rank", "a")).resolves.toBe(1);
    await expect(sortedSet.zrange("rank", 0, -1)).resolves.toEqual(["a", "b"]);
    await expect(sortedSet.zrangeByScore("rank", 1, 2)).resolves.toEqual(["a", "b"]);
    await expect(sortedSet.zrank("rank", "b")).resolves.toBe(1);
    await expect(sortedSet.zcount("rank", 1, 2)).resolves.toBe(2);
    await expect(sortedSet.zpopmin("rank")).resolves.toEqual([{ member: "a", score: 1 }]);
  });

  test("list supports push, range and pop", async () => {
    const list = new PgList({ sql: new ListSql(), now: () => 1000 });

    await expect(list.rpush("jobs", "a", "b")).resolves.toBe(2);
    await expect(list.lpush("jobs", "head")).resolves.toBe(3);
    await expect(list.lrange("jobs")).resolves.toEqual(["head", "a", "b"]);
    await expect(list.lpop("jobs")).resolves.toEqual(["head"]);
    await expect(list.rpop("jobs")).resolves.toEqual(["b"]);
    await expect(list.llen("jobs")).resolves.toBe(1);
  });
});
