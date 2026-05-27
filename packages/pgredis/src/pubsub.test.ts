import { describe, expect, test } from "bun:test";
import { createPgPublisher, publishPgNotify } from "./pubsub";
import type { PgSqlLike } from "./sql";

class MockSql implements PgSqlLike {
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    return [] as T[];
  }
}

describe("pubsub", () => {
  test("publishes string and JSON payloads through pg_notify", async () => {
    const sql = new MockSql();

    await publishPgNotify(sql, "events", "plain");
    await createPgPublisher(sql).publish("events", { ok: true });

    expect(sql.queries).toEqual([
      { query: "SELECT pg_notify($1, $2)", params: ["events", "plain"] },
      { query: "SELECT pg_notify($1, $2)", params: ["events", "{\"ok\":true}"] }
    ]);
  });
});
