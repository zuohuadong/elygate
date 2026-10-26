import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixtures = [
  { directory: "edge-case-server", tool: "unicode_tool", field: "id" },
  {
    directory: "error-test-server",
    tool: "intermittent_fail",
    field: "id",
    extra: { fail_rate: 0 },
  },
  { directory: "parallel-test-server", tool: "fast_tool_1", field: "id" },
  {
    directory: "temperature",
    serverName: "temperature-server",
    tool: "echo",
    field: "text",
  },
  { directory: "test-tools-server", tool: "echo", field: "message" },
];

for (const fixture of fixtures) {
  test(`${fixture.directory}: dependency and STDIO compatibility`, { timeout: 30000 }, async (t) => {
    const directory = new URL(`${fixture.directory}/`, import.meta.url);
    const require = createRequire(new URL("package.json", directory));
    const manifest = require("./package.json");
    const zodVersion = require("zod/package.json").version;
    assert.equal(zodVersion, manifest.dependencies.zod);

    const clientModule = require.resolve("@modelcontextprotocol/sdk/client/index.js");
    const sdkRequire = createRequire(clientModule);
    assert.equal(sdkRequire("zod/package.json").version, zodVersion);
    const { Client } = await import(pathToFileURL(clientModule).href);
    const { StdioClientTransport } = await import(
      pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href
    );
    const client = new Client({ name: "dependency-compat-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("dist/index.js", directory))],
      cwd: fileURLToPath(directory),
      stderr: "pipe",
    });
    transport.stderr?.resume();
    t.after(() => client.close());
    const options = { timeout: 10000, signal: t.signal };
    await client.connect(transport, options);
    assert.equal(client.getServerVersion()?.name, fixture.serverName ?? fixture.directory);

    const { tools } = await client.listTools(undefined, options);
    const tool = tools.find((tool) => tool.name === fixture.tool);
    assert.ok(tool, `${fixture.tool} must remain discoverable`);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.properties[fixture.field].type, "string");
    assert.ok(tool.inputSchema.required.includes(fixture.field));

    const args = { [fixture.field]: "dependency-compat", ...fixture.extra };
    const result = await client.callTool({ name: fixture.tool, arguments: args }, undefined, options);
    assert.notEqual(result.isError, true);
    assert.equal(result.content[0].type, "text");
    assert.equal(JSON.parse(result.content[0].text)[fixture.field], args[fixture.field]);

    for (const invalid of [{}, { ...args, [fixture.field]: 42 }]) {
      const rejected = await client.callTool(
        { name: fixture.tool, arguments: invalid },
        undefined,
        options,
      );
      assert.equal(rejected.isError, true, "missing and incorrectly typed inputs must be rejected");
    }
  });
}
