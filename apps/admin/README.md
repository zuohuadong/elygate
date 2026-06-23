# apps/admin

Built with [svadmin](https://github.com/zuohuadong/svadmin) — Headless Admin Framework for Svelte 5.

## Getting Started

```bash
bun install
bun run dev
```

## Stack

- **UI**: Svelte 5 + Shadcn Svelte + TailwindCSS
- **Data**: Simple REST DataProvider
- **Auth**: JWT
- **State**: TanStack Query v6

## Boundary

`apps/admin` is the Elygate Panel for general gateway management. Enterprise IAM, SupaCloud lifecycle, tenant isolation, and audit surfaces live in `apps/enterprise-console` and `/api/enterprise/*`.
