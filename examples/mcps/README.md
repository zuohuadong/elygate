# MCP Example Compatibility Tests

Install and build `edge-case-server`, `error-test-server`, `parallel-test-server`,
`temperature`, and `test-tools-server` with `npm ci` and `npm run build` in each
directory. Then run from the repository root:

```sh
node --test examples/mcps/dependency-compat.test.mjs
```

The test uses each example's installed MCP SDK and starts its compiled STDIO
server. It verifies dependency resolution, initialization, tool discovery, a
deterministic successful call, and rejection of missing or incorrectly typed
arguments. It requires no gateway, API credentials, or external model calls.
