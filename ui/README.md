# Elygate Console

Elygate Console is the built-in React + Vite management UI for the Elygate AI
Gateway. It configures providers, routing, virtual keys, budgets, MCP, plugins,
logs, and observability without introducing a second admin/control plane.

The console talks to the Go HTTP transport through typed REST and WebSocket APIs.
It is built into static assets and served by the gateway in production.

```bash
npm ci
npm run build
```

During development, `npm run dev` starts the console on port 3000. `make dev` starts
both the console and gateway together on port 8080.

The product is branded as Elygate while retaining upstream attribution and the
Apache-2.0 license; see [UPSTREAM.md](../UPSTREAM.md). Semantic caching is disabled
in the Elygate deployment baseline and must not be enabled for coding, agentic, or
multi-turn traffic without a scoped review.
