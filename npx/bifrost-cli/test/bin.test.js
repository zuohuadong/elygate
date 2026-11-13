import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const binJs = join(dirname(fileURLToPath(import.meta.url)), "..", "bin.js");

for (const bad of ["v1.0.0-01", "v1.0.0-..", "v1.0.0-rc..1", "v1.2.3+build.1", "v01.2.3"]) {
	test(`rejects non-SemVer CLI version ${bad}`, () => {
		const r = spawnSync(process.execPath, [binJs, "--cli-version", bad, "--help"], { encoding: "utf8" });
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stderr, /Invalid CLI version format/);
	});
}
