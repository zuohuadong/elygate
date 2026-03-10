# Elygate Gateway

This is the high-performance API gateway for the Elygate project, built with [Elysia.js](https://elysiajs.com/) and running on the [Bun](https://bun.sh/) runtime.

## Features

- **Blazing Fast**: Leverages Bun's native asynchronous I/O and Elysia's optimized routing.
- **Semantic Caching**: Integrated vector similarity search using `pgvector` to deduplicate and cache expensive AI requests.
- **Atomic Billing**: O(1) batch processing eliminates SQL lock contention for high-throughput accounting.

## Development

To run the gateway in development mode with hot-reloading:

```bash
cd ../.. # Go to project root
bun run dev
```

Alternatively, from within this directory:

```bash
bun install
bun run dev
```