# @elygate/pg-kv-cache

Bun.SQL-only PostgreSQL KV/TTL cache. It provides:

- local L1 cache with TTL and max-size eviction
- PostgreSQL JSONB L2 storage via `Bun.SQL`
- `get`, `set`, `mget`, `mset`, `delete`, `clearPrefix`, `clearNamespace`
- schema bootstrap with an `UNLOGGED` table by default
- PostgreSQL `NOTIFY` publishing for cross-instance L1 invalidation

## Usage

```ts
import { sql } from "@elygate/db";
import { createPgKvCache } from "@elygate/pg-kv-cache";

const cache = createPgKvCache({
  sql,
  namespace: "auth",
  l1: { max: 10_000, ttlMs: 60_000 },
  notify: { channel: "cache_invalidate" }
});

await cache.ensureSchema();
await cache.set("token:abc", { userId: 1 }, { ttlMs: 60_000 });

const auth = await cache.get<{ userId: number }>("token:abc");
```

## Cross-instance invalidation

This package publishes invalidation events with `pg_notify`. Use a listener such as `@elygate/pg-listen` to receive them and call `handleNotification`.

```ts
import { createPgListener } from "@elygate/pg-listen";

createPgListener(databaseUrl, ["cache_invalidate"], (_channel, payload) => {
  cache.handleNotification(payload);
});
```

`handleNotification` ignores events from the same cache instance, so local writes can update L1 immediately without being invalidated by their own notification.
