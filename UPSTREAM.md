# Upstream synchronization policy

This branch is pinned to Bifrost upstream commit `3fbd9a4f707304ed6f988e9b26593c6ffc67e4d0`.

- Only panel-facing labels, titles, and visual assets use the **Elygate** display name.
- Gateway, CLI, Helm, environment variables, protocol names, storage identifiers,
  container examples, and documentation retain the **Bifrost** name to keep upstream
  synchronization low-conflict.
- Go module paths, `x-bf-*` protocol headers, and Bifrost storage identifiers remain
  internal compatibility boundaries with upstream. They are not product branding and
  are changed only in a deliberately versioned protocol migration.
- The Apache-2.0 `LICENSE`, copyright notices, and upstream attribution remain intact.
- This branch intentionally removes the prior Bun/Elysia product tree. It does not
  preserve its API, schema, or management-console compatibility layer.
- Semantic caching is intentionally disabled in the default configuration. Do not add
  a vector store or enable the `semantic_cache` plugin without a separately reviewed,
  scoped use case.

## Enterprise source boundary

The public Bifrost source tree does not include Bifrost Enterprise modules. Features
whose implementation is not present in this repository must not be represented as
implemented merely because an upstream Enterprise documentation page or UI fallback
exists. They require licensed source access or a fork-owned implementation.
