import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { resolveEnterprisePanelModule } from '../../vite-enterprise-panel.mjs';

describe('enterprise panel build contract', () => {
	test('uses the OSS fallback for ordinary builds', () => {
		const fallback = new URL('../enterprise-fallback/index.ts', import.meta.url).pathname;
		expect(resolveEnterprisePanelModule({ fallbackPath: fallback })).toBe(fallback);
	});

	test('fails a required enterprise build without a private module', () => {
		expect(() => resolveEnterprisePanelModule({ fallbackPath: '/fallback.ts', required: true }))
			.toThrow('BIFROST_ENTERPRISE_PANEL_PATH');
	});

	test('rejects an explicitly configured missing module', () => {
		expect(() => resolveEnterprisePanelModule({
			fallbackPath: '/fallback.ts',
			modulePath: '/definitely/missing/elygate-enterprise-panel.ts',
		})).toThrow('does not exist');
	});

	test('accepts an existing module for a required enterprise build', () => {
		const modulePath = new URL('../enterprise-fallback/index.ts', import.meta.url).pathname;
		expect(resolveEnterprisePanelModule({
			fallbackPath: '/fallback.ts',
			modulePath,
			required: true,
		})).toBe(modulePath);
	});

	test('Docker build supports an isolated named enterprise panel context', async () => {
		const dockerfile = await Bun.file(new URL('../../../transports/Dockerfile', import.meta.url)).text();
		expect(dockerfile).toContain('COPY panel/patches ./patches');
		expect(dockerfile).toContain('FROM scratch AS enterprise_panel');
		expect(dockerfile).toContain('COPY --from=enterprise_panel / /opt/elygate-enterprise-panel/');
		expect(dockerfile).toContain('COPY docs/ /docs/');
		expect(dockerfile).toContain('BIFROST_ENTERPRISE_PANEL_PATH=$BIFROST_ENTERPRISE_PANEL_PATH');
		expect(dockerfile).toContain('FROM --platform=$BUILDPLATFORM oven/bun:');
		expect(dockerfile).toContain('go work init');
		expect(dockerfile).toContain('COPY core/ ./core/');
		expect(dockerfile).toContain('COPY transports/ ./transports/');
		expect(dockerfile).toContain('COPY --from=builder /app/transports/docker-entrypoint.sh .');
	});

	test('local release Dockerfile includes the panel documentation sources', async () => {
		const dockerfile = await Bun.file(new URL('../../../transports/Dockerfile.local', import.meta.url)).text();
		expect(dockerfile).toContain('COPY panel/patches ./patches');
		expect(dockerfile).toContain('COPY docs/ /docs/');
		expect(dockerfile.match(/apk add --no-cache[^\n]*git/g)).toHaveLength(2);
	});

	test('Red Hat release Dockerfile includes panel docs and the local Go workspace', async () => {
		const dockerfile = await Bun.file(new URL('../../../transports/Dockerfile.redhat', import.meta.url)).text();
		expect(dockerfile).toContain('COPY panel/patches ./patches');
		expect(dockerfile).toContain('COPY docs/ /docs/');
		expect(dockerfile).toContain('GOWORK=/app/go.work');
		expect(dockerfile).toContain('go work init');
		expect(dockerfile).toContain('COPY core/ ./core/');
		expect(dockerfile).toContain('COPY framework/ ./framework/');
		expect(dockerfile).toContain('COPY plugins/routing/ ./plugins/routing/');
		expect(dockerfile).toContain('COPY plugins/safety/go.mod ./plugins/safety/');
		expect(dockerfile).toContain('COPY plugins/safety/ ./plugins/safety/');
		expect(dockerfile).toContain('WORKDIR /app/transports');
		expect(dockerfile).toContain('COPY --from=builder /app/transports/docker-entrypoint.sh .');
	});

	test('every release Dockerfile keeps the musl sqlite-vec CGO aliases', async () => {
		for (const name of ['Dockerfile', 'Dockerfile.local', 'Dockerfile.redhat']) {
			const dockerfile = await Bun.file(new URL(`../../../transports/${name}`, import.meta.url)).text();
			expect(dockerfile).toContain('-Du_int8_t=uint8_t');
			expect(dockerfile).toContain('-Du_int16_t=uint16_t');
			expect(dockerfile).toContain('-Du_int64_t=uint64_t');
		}
	});

	test('panel and Docker gates cover main and dev without expanding publishing permissions', async () => {
		const workflow = parse(await Bun.file(new URL('../../../.github/workflows/panel-tests.yml', import.meta.url)).text());
		expect(new Set(workflow.on.push.branches)).toEqual(new Set(['main', 'dev']));
		expect(workflow.on.push.paths).toEqual(workflow.on.pull_request.paths);
		for (const path of ['.bun-version', 'panel/**', 'enterprise/employee-portal/**',
			'transports/bifrost-http/**', 'framework/configstore/**', 'framework/logstore/**',
			'plugins/logging/**', 'Makefile', 'transports/Dockerfile*', '.github/workflows/panel-tests.yml',
			'.github/workflows/scripts/smoke-elygate-image.sh', 'examples/single-node-postgres/**']) {
			expect(workflow.on.push.paths).toContain(path);
		}
		expect(workflow.on).toHaveProperty('workflow_dispatch');
		expect(workflow.permissions).toEqual({ contents: 'read' });
		expect(workflow.jobs.docker.needs).toBe('panel');
		const imageBuild = workflow.jobs.docker.steps.find((step: { name?: string }) =>
			step.name === 'Build image without publishing');
		expect(imageBuild.with.push).toBe(false);
		expect(imageBuild.with.load).toBe(true);
		expect(imageBuild.with['build-args']).toContain('VERSION=${{ github.sha }}');
		const runtime = workflow.jobs.docker.steps.find((step: { name?: string }) =>
			step.name === 'Start image and verify runtime health');
		expect(runtime.env.IMAGE_COMMIT).toBe('${{ github.sha }}');
		expect(runtime.run).toBe('bash .github/workflows/scripts/smoke-elygate-image.sh elygate:panel-ci "$IMAGE_COMMIT"');
		expect(workflow.jobs.docker['timeout-minutes']).toBe(20);
	});

	test('image smoke rejects an invalid candidate before Docker allocation', async () => {
		const script = new URL('../../../.github/workflows/scripts/smoke-elygate-image.sh', import.meta.url);
		const child = Bun.spawn(['/bin/bash', script.pathname, 'elygate:panel-ci', 'not-a-commit'], {
			env: { PATH: '/definitely/no/docker' }, stdout: 'pipe', stderr: 'pipe',
		});
		expect(await child.exited).toBe(2);
		expect(await new Response(child.stderr).text()).toContain('expected a full Git commit SHA');
	});

	test.each([null, { '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '49152' }] },
		{ '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '49152' }] }])(
		'image smoke validates loopback mappings, refreshes them on restart and cleans resources (%j)', async (ports) => {
			const workspace = mkdtempSync(join(tmpdir(), 'elygate-image-test-'));
			try {
				const calls = join(workspace, 'calls');
				const docker = join(workspace, 'docker');
				await Bun.write(docker, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_CALLS"
case "$1:\${2:-}" in
  compose:*) printf '{"services":{"postgres":{"image":"postgres@sha256:%064d"}}}\\n' 0 ;;
  image:inspect) printf '1000:0\\n' ;;
  inspect:*)
    case "\${@: -1}" in
      '{{json .NetworkSettings.Ports}}')
        if [ -e "$TMPDIR/restarted" ]; then
          printf '{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"49153"}]}\\n'
        else
          printf '%s\\n' "$MOCK_PORTS"
        fi ;;
      '{{.State.Running}}') printf 'true\\n' ;;
      '{{.State.Health.Status}}') printf 'healthy\\n' ;;
      '{{.State.ExitCode}}'|'{{.RestartCount}}') printf '0\\n' ;;
      '{{.State.OOMKilled}}') printf 'false\\n' ;;
    esac ;;
  exec:*)
    case "$3" in
      id) printf '1000\\n' ;;
      psql) printf '2\\n' ;;
    esac ;;
  start:*-gateway) touch "$TMPDIR/restarted" ;;
  logs:*) printf 'postgres_password=%s\\nencryption_key=%s\\nsetup_token=%s\\nimage_password=%s\\n' \\
    "$POSTGRES_PASSWORD" "$ENCRYPTION_KEY" "$SETUP_TOKEN" "$ELYGATE_IMAGE_PASSWORD" ;;
esac
`);
				chmodSync(docker, 0o700);
				const curl = join(workspace, 'curl');
				await Bun.write(curl, `#!/usr/bin/env bash
set -euo pipefail
url="\${!#}"
printf 'http %s\\n' "$url" >> "$MOCK_CALLS"
port=49152
if [ -e "$TMPDIR/restarted" ]; then port=49153; fi
[[ "$url" == "http://127.0.0.1:$port/"* ]] || exit 22
if [[ "$url" == */health ]]; then
  printf '{"status":"ok","components":{"db_pings":"ok"}}\\n'
  exit
fi
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then output=$2; break; fi
  shift
done
printf '{}\\n' > "$output"
case "$url" in
  */api/session/login) touch "$TMPDIR/logged-in"; printf 200 ;;
  */api/session/logout) rm "$TMPDIR/logged-in"; printf 200 ;;
  */api/version) printf '"v%s"\\n' "$MOCK_COMMIT" > "$output"; printf 200 ;;
  */api/config) if [ -e "$TMPDIR/logged-in" ]; then printf 200; else printf 401; fi ;;
  *) exit 22 ;;
esac
`);
				chmodSync(curl, 0o700);
				await Bun.write(join(workspace, 'sleep'), '#!/bin/sh\nexit 1\n');
				chmodSync(join(workspace, 'sleep'), 0o700);
				const script = new URL('../../../.github/workflows/scripts/smoke-elygate-image.sh', import.meta.url);
				const commit = '1'.repeat(40);
				const child = Bun.spawn(['/bin/bash', script.pathname, 'elygate:panel-ci', commit], {
					env: { ...process.env, PATH: `${workspace}:${process.env.PATH}`, TMPDIR: workspace,
						MOCK_CALLS: calls, MOCK_PORTS: JSON.stringify(ports), MOCK_COMMIT: commit },
					stdout: 'pipe', stderr: 'pipe',
				});
				const [status, stdout, stderr] = await Promise.all([
					child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
				]);
				const commands = (await Bun.file(calls).text()).split('\n');
				const valid = ports?.['8080/tcp'][0].HostIp === '127.0.0.1';
				if (valid) {
					expect(status).toBe(0);
					expect(stderr).toBe('');
					expect(stdout).toContain('PASS image assertions');
					expect(commands.filter((line) => line.includes('{{json .NetworkSettings.Ports}}'))).toHaveLength(2);
					expect(commands).toContain('http http://127.0.0.1:49152/health');
					expect(commands).toContain('http http://127.0.0.1:49153/health');
					expect(commands).toContain('http http://127.0.0.1:49153/api/session/logout');
				} else {
					expect(status).toBe(1);
					expect(stderr).toContain('gateway has no unique published loopback HTTP port');
					for (const key of ['postgres_password', 'encryption_key', 'setup_token', 'image_password']) {
						expect(stderr).toContain(`${key}=[REDACTED_SECRET]`);
					}
					expect(stdout).not.toContain('PASS');
				}
				expect(commands.some((line) => line.startsWith('network create elygate-image-'))).toBe(true);
				expect(commands.some((line) => line.includes('--internal'))).toBe(false);
				expect(commands.some((line) => line.includes('--publish 127.0.0.1::8080'))).toBe(true);
				expect(commands.filter((line) => line.startsWith('rm --force --volumes '))).toHaveLength(2);
				expect(commands.filter((line) => line.startsWith('volume rm '))).toHaveLength(2);
				expect(commands.filter((line) => line.startsWith('network rm '))).toHaveLength(1);
				expect(readdirSync(workspace).filter((name) => name.startsWith('elygate-image.'))).toEqual([]);
			} finally {
				rmSync(workspace, { recursive: true, force: true });
			}
		},
		30_000,
	);

	test('API contracts initialize the Go workspace before running on a clean checkout', async () => {
		const workflow = parse(await Bun.file(new URL('../../../.github/workflows/panel-tests.yml', import.meta.url)).text());
		const steps = workflow.jobs['api-contracts'].steps;
		expect(workflow.jobs['api-contracts'].env.GOTOOLCHAIN).toBe('auto');
		const setupIndex = steps.findIndex((step: { uses?: string }) => step.uses?.startsWith('actions/setup-go@'));
		const workspaceIndex = steps.findIndex((step: { name?: string }) => step.name === 'Initialize Go workspace');
		const testIndex = steps.findIndex((step: { name?: string }) => step.name === 'Run API contracts');
		expect(setupIndex).toBeGreaterThan(0);
		expect(steps[setupIndex].with['go-version']).toBe('1.27.3');
		expect(workspaceIndex).toBeGreaterThan(setupIndex);
		expect(steps[workspaceIndex].run).toBe('source ./.github/workflows/scripts/setup-go-workspace.sh');
		expect(testIndex).toBeGreaterThan(workspaceIndex);
		expect(steps[testIndex].run).toBe("bash scripts/go-local.sh test -p 1 ./transports/bifrost-http/controlplane ./transports/bifrost-http/employees ./transports/bifrost-http/handlers -run 'Test(ApplicationKeyRouter|UsageReconciliation|LoginLimiter|Session|Auth|CorsAccessLog)' -count=1 -timeout=120s");
	});
});
