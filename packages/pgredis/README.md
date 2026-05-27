# pgredis

PostgreSQL-only application infrastructure toolkit for projects that want to
replace a Redis + PostgreSQL stack with PostgreSQL alone.

`pgredis` is not a Redis protocol-compatible client and is not a drop-in
replacement for `ioredis`, `node-redis`, Bull, or Redis Cluster. It replaces the
Redis infrastructure use cases with PostgreSQL-friendly primitives.

It provides:

- KV/TTL cache via `@elygate/pg-kv-cache`
- atomic counters
- hash, set, list, and sorted-set helpers
- cursor-style scans and structure-level TTL for collection helpers
- Pub/Sub helpers via PostgreSQL `LISTEN/NOTIFY`
- transaction-scoped advisory locks
- fixed-window, sliding-window, and token-bucket rate limiting
- a simple `pg-boss` queue adapter for background jobs and long tasks
- a `createPgredis()` facade for one-shot initialization, health, stats, and cleanup

## Install

```bash
bun add pgredis
```

## KV/TTL cache

```ts
import { createPgKvCache } from "pgredis";

const cache = createPgKvCache({
  sql,
  namespace: "auth",
  l1: { max: 10_000, ttlMs: 60_000 }
});

await cache.ensureSchema();
await cache.set("token:abc", { userId: 1 }, { ttlMs: 60_000 });
const value = await cache.get<{ userId: number }>("token:abc");
```

## Unified client

```ts
import { createPgredis } from "pgredis";

const pg = createPgredis({
  sql,
  namespace: "app",
  rateLimit: { limit: 60, windowMs: 60_000 },
  queue: {
    connectionString: process.env.DATABASE_URL,
    schema: "pgboss"
  }
});

await pg.ensureSchema();

await pg.cache.set("token:abc", { userId: 1 }, { ttlMs: 60_000 });
await pg.counter.incr("daily:requests");
await pg.hash.hset("session:abc", "userId", 1);
await pg.set.sadd("online-users", "1");
await pg.list.rpush("recent-events", { id: "evt_1" });
await pg.sortedSet.zadd("leaderboard", 100, "user:1");
await pg.hash.expire("session:abc", 60_000);
await pg.hash.hscan("session:abc", null, 100);
await pg.health();
await pg.stats();
const stopCleanup = pg.startCleanupWorker({ intervalMs: 60_000 });
```

## Pub/Sub

```ts
import { createPgListener, publishPgNotify } from "pgredis";

createPgListener(databaseUrl, ["cache_invalidate"], (_channel, payload) => {
  console.log(payload);
});

await publishPgNotify(sql, "cache_invalidate", { key: "token:abc" });
```

## Advisory lock

`withPgAdvisoryLock` uses transaction-scoped locks, so locks are released by
PostgreSQL when the transaction ends.

```ts
import { withPgAdvisoryLock } from "pgredis";

await withPgAdvisoryLock(sql, "billing:flush", async (tx) => {
  await tx.unsafe("SELECT 1");
});
```

## Rate limit

```ts
import { createPgFixedWindowRateLimiter } from "pgredis";

const limiter = createPgFixedWindowRateLimiter({
  sql,
  namespace: "api",
  limit: 60,
  windowMs: 60_000
});

await limiter.ensureSchema();
const result = await limiter.hit("user:1");
```

## Queue

```ts
import { createPgBossJobQueue } from "pgredis";

const queue = createPgBossJobQueue({
  connectionString: process.env.DATABASE_URL,
  schema: "pgboss",
  queues: {
    "webhook.deliver": { retryLimit: 5, retryBackoff: true }
  }
});

await queue.start();
await queue.send("webhook.deliver", { event: "created" });
await queue.work("webhook.deliver", { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) console.log(job.data);
});
```

`pgredis` intentionally keeps the queue API close to `pg-boss`:

- `start()` starts `pg-boss` and creates configured queues.
- `ensureQueue()` creates or updates queue metadata.
- `send()` enqueues jobs.
- `work()` registers workers.
- `getBoss()` returns the underlying `PgBoss` instance for advanced cases.

This covers Redis-backed background job use cases such as Bull-style async
webhooks, billing flushes, retries, and long tasks. It does not emulate Redis
Streams commands.

## Redis feature coverage

Redis has a broad surface area across core data types, server operations,
programmability, clustering, modules, and observability. `pgredis` targets
feature replacement, not command compatibility.

| Redis capability | pgredis status | Replacement strategy | Gap |
| --- | --- | --- | --- |
| String `GET`/`SET`/`DEL`/TTL | Covered | `PgKvCache` stores JSONB values with optional TTL and L1 cache | No byte-level Redis string ops such as `APPEND`, `GETRANGE`, `SETRANGE` |
| Key expiration | Covered | `expires_at`, `cleanupExpired`, L1 TTL | No Redis passive/active eviction semantics or keyspace notifications |
| Batch get/set | Covered | `mget`, `mset` | No pipelining API yet |
| Atomic counters | Covered | `PgCounter` over BIGINT UPSERT | Integer counters only |
| Pub/Sub | Covered | `LISTEN/NOTIFY` plus `createPgListener` | Not durable, payload size is limited by PostgreSQL NOTIFY |
| Distributed locks | Covered | Transaction-scoped advisory locks | No Redlock-compatible lease renewal model |
| Fixed-window rate limit | Covered | UPSERT counter table with window reset metadata | Covered for coarse windows |
| Sliding-window rate limit | Covered | Bucketed moving-window counters | Precision depends on configured bucket size |
| Token-bucket rate limit | Covered | PostgreSQL row state with refill calculation | Designed for app-level API throttling |
| Queues / delayed jobs / retries | Covered via adapter | `pg-boss` wrapper | Not Redis Streams compatible |
| Hashes | Covered | `PgHash` over `(namespace, key, field)` rows | `HSCAN`-style cursor scan and key TTL covered; no per-field TTL |
| Lists | Covered | `PgList` over ordered rows | Cursor scan and key TTL covered; no blocking pop; use pg-boss for real job queues |
| Sets | Covered | `PgSet` over unique-indexed rows | `SINTER`, `SUNION`, `SDIFF`, cursor scan, and key TTL covered |
| Sorted sets | Covered | `PgSortedSet` over `(member, score)` rows | Rank, score range, count, pop-min, scan, and key TTL covered |
| Streams / consumer groups | Delegated / missing | Use `pg-boss` for jobs; application table for event logs | No `XADD`, `XREADGROUP`, pending-entry list |
| Transactions / optimistic watch | Missing | Use PostgreSQL transactions and row locks directly | No Redis `MULTI`/`EXEC`/`WATCH` facade |
| Lua scripting / functions | Out of scope | Use SQL, stored procedures, or app code | No Redis Lua/function runtime |
| Bitmaps / bitfields | Missing | Use `bytea`, roaring bitmap extension, or SQL tables | No bit operation API |
| HyperLogLog | Missing | Use PostgreSQL extensions or approximate-count tables | No `PFADD`/`PFCOUNT` |
| Geospatial | Missing | Use PostGIS | No Redis GEO command facade |
| JSON document commands | Partial | KV values are JSONB | No RedisJSON path mutation/query API |
| Search / vector search | Missing | Use PostgreSQL full-text search, `pg_trgm`, `pgvector` | No RediSearch-compatible query API |
| Time series | Missing | Use hypertables/partitioned tables/TimescaleDB | No RedisTimeSeries API |
| Bloom / Cuckoo / Count-Min | Missing | Use PostgreSQL extensions or app tables | No RedisBloom-compatible API |
| ACL/auth | Out of scope | Use PostgreSQL credentials and application auth | No Redis ACL facade |
| Persistence/replication/cluster | Out of scope | Inherited from PostgreSQL deployment | No Redis Cluster slot/hash semantics |
| Server introspection | Partial | `createPgredis().health()` and `stats()` expose basic health/cache/queue stats | No Redis `INFO`, `MONITOR`, command stats facade |

## Missing pieces to consider next

The highest-value additions for Redis replacement are now:

1. Blocking pop semantics for lists, if a project needs Redis-like worker pulls.
2. More stats adapters for table sizes, cleanup counts, and queue lag.
3. Optional durable event/outbox API for stream-like audit/event logs.
4. Optional adapters for common frameworks such as Express/Fastify/Elysia session stores.
5. Redis command-name aliases for easier migration without protocol compatibility.

## Design notes

This is a toolkit, not a Redis-compatible client. It intentionally exposes
PostgreSQL-friendly semantics:

- locks are transaction-scoped advisory locks
- pub/sub is `LISTEN/NOTIFY`, not durable messaging
- queues are delegated to `pg-boss`
- KV values are JSONB rows with optional local L1 caching
