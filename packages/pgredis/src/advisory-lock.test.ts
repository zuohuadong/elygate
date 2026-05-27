import { describe, expect, test } from "bun:test";
import {
  PgAdvisoryLockBusyError,
  advisoryLockKeyToSqlArgs,
  withPgAdvisoryLock
} from "./advisory-lock";
import type { PgSqlLike } from "./sql";

class MockSql implements PgSqlLike {
  tryLocked = true;
  beginCount = 0;
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    if (query.includes("pg_try_advisory_xact_lock")) {
      return [{ locked: this.tryLocked }] as T[];
    }
    return [] as T[];
  }

  async begin<T>(callback: (tx: PgSqlLike) => Promise<T>): Promise<T> {
    this.beginCount++;
    return callback(this);
  }
}

describe("advisory lock", () => {
  test("maps string keys to deterministic two-int lock keys", () => {
    const first = advisoryLockKeyToSqlArgs("billing:flush");
    const second = advisoryLockKeyToSqlArgs("billing:flush");

    expect(first).toEqual(second);
    expect(first.expression).toBe("$1::int, $2::int");
    expect(first.params).toHaveLength(2);
  });

  test("runs callback inside a transaction-scoped advisory lock", async () => {
    const sql = new MockSql();

    const result = await withPgAdvisoryLock(sql, "webhook:deliver", async (tx) => {
      await tx.unsafe("SELECT 1");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(sql.beginCount).toBe(1);
    expect(sql.queries[0]!.query).toContain("pg_advisory_xact_lock");
    expect(sql.queries[1]!.query).toBe("SELECT 1");
  });

  test("throws PgAdvisoryLockBusyError when try-lock is busy", async () => {
    const sql = new MockSql();
    sql.tryLocked = false;

    await expect(
      withPgAdvisoryLock(sql, "busy", async () => "unreachable", { wait: false })
    ).rejects.toBeInstanceOf(PgAdvisoryLockBusyError);
  });

  test("requires transaction support", async () => {
    const sql: PgSqlLike = {
      async unsafe() {
        return [];
      }
    };

    await expect(
      withPgAdvisoryLock(sql, "missing-transaction", async () => "unreachable")
    ).rejects.toThrow("transaction-capable");
  });
});
