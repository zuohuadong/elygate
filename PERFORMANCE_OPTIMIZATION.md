# Elygate Performance Optimization Guide ⚡

This guide explains the performance architecture of Elygate and how to tune your
PostgreSQL 18 instances for maximum throughput.

## 1. PostgreSQL 18.3 Optimization

Elygate is optimized for the latest PostgreSQL 18 features, including improved
asynchronous I/O and better parallelism.

### Automated Tuning

We provide a script to automatically apply baseline optimizations:

```bash
chmod +x scripts/deploy-optimizations.sh
./scripts/deploy-optimizations.sh
```

### Key Parameters for PG18

If you are manually tuning `postgresql.conf`, consider these values for
high-performance NVMe storage:

| Parameter                  | Value  | Description                         |
| :------------------------- | :----- | :---------------------------------- |
| `shared_buffers`           | `1GB`+ | 25% of total RAM                    |
| `work_mem`                 | `16MB` | Per-operation sorting memory        |
| `effective_io_concurrency` | `200`  | NVMe storage parallelism (PG18 AIO) |
| `random_page_cost`         | `1.1`  | SSD/NVMe optimized cost             |
| `max_parallel_workers`     | `8`    | Parallel query execution            |

## 2. Index Optimization

Elygate uses a sophisticated indexing strategy to ensure O(1) or O(log N) lookup
times on the hot path.

### Performance Indexes

The script `packages/db/src/performance_indexes.sql` includes:

- **Composite Indexes**: Optimized for `user_id` + `created_at` sorting.
- **Partial Indexes**: Only index active rows (e.g., `WHERE status = 1`),
  reducing index size by up to 80%.
- **GIN Trigram Indexes**: High-performance fuzzy search for model names using
  `pg_trgm`.

## 3. Application Tuning (Bun + Elysia)

### Connection Pooling

Elygate manages a persistent connection pool. You can tune this in your `.env`:

- `DB_POOL_SIZE`: Set to 20 per gateway instance.
- `DB_MAX_PIPELINE`: Enabled by default to batch requests.

### Semantic Cache

Enable the vector-based semantic cache to reduce LLM costs and latency:

- **Config**: Set `SEMANTIC_CACHE_ENABLED=true` in `.env`.
- **Threshold**: Tune similarity in the `options` table (default `0.95`).

## 4. Monitoring Performance

Run the statistics queries in `performance_indexes.sql` to detect unused indexes
or slow tables.

```sql
SELECT indexname, idx_scan, idx_tup_read FROM pg_stat_user_indexes;
```

---

_Last updated for Elygate v1.2 with PostgreSQL 18 support._
