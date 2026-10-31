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

	test.each(['Dockerfile', 'Dockerfile.local', 'Dockerfile.redhat'])(
		'%s installs unpatched panel dependencies before copying application sources',
		async (name) => {
			const manifest = await Bun.file(new URL('../../package.json', import.meta.url)).json();
			expect(manifest.patchedDependencies).toBeUndefined();
			const dockerfile = await Bun.file(new URL(`../../../transports/${name}`, import.meta.url)).text();
			const manifests = dockerfile.indexOf('COPY panel/package.json panel/bun.lock ./');
			const install = dockerfile.indexOf('RUN bun install --frozen-lockfile');
			const sources = dockerfile.indexOf('COPY panel/ ./');
			expect(manifests).toBeGreaterThanOrEqual(0);
			expect(install).toBeGreaterThan(manifests);
			expect(sources).toBeGreaterThan(install);
			expect(dockerfile).not.toMatch(/^\s*COPY\s+panel\/patches(?:\/|\s)/m);
		},
	);

	test('Docker build supports an isolated named enterprise panel context', async () => {
		const dockerfile = await Bun.file(new URL('../../../transports/Dockerfile', import.meta.url)).text();
		expect(dockerfile).not.toContain('COPY panel/patches ./patches');
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
		expect(dockerfile).not.toContain('COPY panel/patches ./patches');
		expect(dockerfile).toContain('COPY docs/ /docs/');
		expect(dockerfile.match(/apk add --no-cache[^\n]*git/g)).toHaveLength(2);
	});

	test('Red Hat release Dockerfile includes panel docs and the local Go workspace', async () => {
		const dockerfile = await Bun.file(new URL('../../../transports/Dockerfile.redhat', import.meta.url)).text();
		expect(dockerfile).not.toContain('COPY panel/patches ./patches');
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
			'.github/workflows/scripts/smoke-elygate-image.sh', 'examples/single-node-postgres/**',
			'scripts/production/**', 'scripts/go-local.sh']) {
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
		expect(runtime.env.IMAGE_ID).toBe('${{ steps.candidate.outputs.image_id }}');
		expect(runtime.run).toBe('bash .github/workflows/scripts/smoke-elygate-image.sh "$IMAGE_ID" "$IMAGE_COMMIT"');
		expect(workflow.jobs.docker['timeout-minutes']).toBe(20);
	});

	test('retains only the successfully tested immutable candidate without publishing it', async () => {
		const workflow = parse(await Bun.file(new URL('../../../.github/workflows/panel-tests.yml', import.meta.url)).text());
		const steps = workflow.jobs.docker.steps;
		const buildIndex = steps.findIndex((step: { name?: string }) => step.name === 'Build image without publishing');
		const identityIndex = steps.findIndex((step: { id?: string }) => step.id === 'candidate');
		const runtimeIndex = steps.findIndex((step: { name?: string }) => step.name === 'Start image and verify runtime health');
		const exportIndex = steps.findIndex((step: { name?: string }) => step.name === 'Export verified candidate image');
		const uploadIndex = steps.findIndex((step: { name?: string }) => step.name === 'Retain verified candidate image');
		expect(identityIndex).toBeGreaterThan(buildIndex);
		expect(runtimeIndex).toBeGreaterThan(identityIndex);
		expect(exportIndex).toBeGreaterThan(runtimeIndex);
		expect(uploadIndex).toBeGreaterThan(exportIndex);
		for (const step of [steps[identityIndex], steps[runtimeIndex], steps[exportIndex], steps[uploadIndex]]) {
			expect(step.if).toBeUndefined();
			expect(step['continue-on-error']).not.toBe(true);
		}
		expect(workflow.jobs.docker['continue-on-error']).not.toBe(true);
		expect(steps[identityIndex].shell).toBe('bash');
		expect(steps[identityIndex].run).toContain("docker image inspect elygate:panel-ci --format '{{.Id}}'");
		const archive = steps[exportIndex];
		expect(archive.shell).toBe('bash');
		expect(archive.env).toEqual({
			IMAGE_ID: '${{ steps.candidate.outputs.image_id }}', IMAGE_COMMIT: '${{ github.sha }}',
		});
		expect(archive.run).toContain('docker image save "$IMAGE_ID" | gzip -n > image.tar.gz');
		expect(archive.run).toContain('sha256sum image.tar.gz provenance.json > SHA256SUMS');
		expect(archive.run).toContain('docker image load --input image.tar.gz');
		const upload = steps[uploadIndex];
		expect(upload.uses).toBe('actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f');
		expect(upload.with.name).toBe('elygate-candidate-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}');
		expect(upload.with.path.trim().split('\n')).toEqual([
			'${{ runner.temp }}/elygate-candidate/image.tar.gz',
			'${{ runner.temp }}/elygate-candidate/provenance.json',
			'${{ runner.temp }}/elygate-candidate/SHA256SUMS',
		]);
		expect(upload.with['if-no-files-found']).toBe('error');
		expect(upload.with['compression-level']).toBe(0);
		expect(upload.with['retention-days']).toBe(7);
	});

	test.each(['success', 'invalid-identity', 'invalid-commit', 'save-failure', 'inspect-mismatch', 'load-failure'])(
		'candidate export executes the workflow shell and fails closed (%s)', async (scenario) => {
			const workflow = parse(await Bun.file(new URL('../../../.github/workflows/panel-tests.yml', import.meta.url)).text());
			const archive = workflow.jobs.docker.steps.find((step: { name?: string }) => step.name === 'Export verified candidate image');
			const workspace = mkdtempSync(join(tmpdir(), 'elygate-candidate-test-'));
			try {
				const docker = join(workspace, 'docker');
				const calls = join(workspace, 'calls');
				const imageID = `sha256:${'a'.repeat(64)}`;
				const commit = 'b'.repeat(40);
				await Bun.write(docker, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_CALLS"
case "$1:\${2:-}" in
  image:save)
    [ "$3" = "$MOCK_IMAGE" ]
    printf 'test-owned docker archive bytes\\n'
    [ "$MOCK_SCENARIO" != "save-failure" ] ;;
  image:inspect)
    [ "$3" = "$MOCK_IMAGE" ]
    image="$MOCK_IMAGE"
    if [ "$MOCK_SCENARIO" = "inspect-mismatch" ]; then image="sha256:wrong"; fi
    printf '[{"Id":"%s","Os":"linux","Architecture":"amd64","Config":{"Env":["PRIVATE_EXPORT_SENTINEL"]}}]\\n' "$image" ;;
  image:load)
    [ "$3" = "--input" ] && [ "$4" = "image.tar.gz" ]
    gzip -t "$4"
    [ "$MOCK_SCENARIO" != "load-failure" ] ;;
  *) exit 2 ;;
esac
`);
				chmodSync(docker, 0o700);
				const child = Bun.spawn(['/bin/bash', '-euo', 'pipefail', '-c', archive.run], {
					env: { ...process.env, PATH: `${workspace}:${process.env.PATH}`, RUNNER_TEMP: workspace,
						IMAGE_ID: scenario === 'invalid-identity' ? 'floating:latest' : imageID,
						IMAGE_COMMIT: scenario === 'invalid-commit' ? 'invalid' : commit,
						MOCK_CALLS: calls, MOCK_IMAGE: imageID, MOCK_SCENARIO: scenario },
					stdout: 'pipe', stderr: 'pipe',
				});
				const [status, stdout, stderr] = await Promise.all([
					child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
				]);
				expect(stdout + stderr).not.toContain('PRIVATE_EXPORT_SENTINEL');
				const candidateDir = join(workspace, 'elygate-candidate');
				if (scenario === 'success') {
					expect(status).toBe(0);
					const provenance = await Bun.file(join(candidateDir, 'provenance.json')).json();
					expect(provenance).toEqual({
						format: 'docker-archive', archive: 'image.tar.gz', source_commit: commit,
						image_id: imageID, os: 'linux', architecture: 'amd64',
					});
					const archiveBytes = await Bun.file(join(candidateDir, 'image.tar.gz')).arrayBuffer();
					const provenanceBytes = await Bun.file(join(candidateDir, 'provenance.json')).arrayBuffer();
					expect(await Bun.file(join(candidateDir, 'SHA256SUMS')).text()).toBe(
						`${new Bun.CryptoHasher('sha256').update(archiveBytes).digest('hex')}  image.tar.gz\n` +
						`${new Bun.CryptoHasher('sha256').update(provenanceBytes).digest('hex')}  provenance.json\n`,
					);
					expect((await Bun.file(calls).text()).trim().split('\n')).toEqual([
						`image save ${imageID}`, `image inspect ${imageID}`, 'image load --input image.tar.gz',
					]);
					expect(readdirSync(candidateDir).sort()).toEqual(['SHA256SUMS', 'image.tar.gz', 'provenance.json']);
				} else {
					expect(status).not.toBe(0);
					if (scenario === 'invalid-identity' || scenario === 'invalid-commit') {
						expect(await Bun.file(calls).exists()).toBe(false);
						expect(readdirSync(workspace)).not.toContain('elygate-candidate');
					} else if (scenario === 'save-failure') {
						expect(await Bun.file(join(candidateDir, 'provenance.json')).exists()).toBe(false);
						expect(await Bun.file(join(candidateDir, 'SHA256SUMS')).exists()).toBe(false);
					} else if (scenario === 'inspect-mismatch') {
						expect(await Bun.file(join(candidateDir, 'SHA256SUMS')).exists()).toBe(false);
						expect(await Bun.file(calls).text()).not.toContain('image load');
					}
				}
			} finally {
				rmSync(workspace, { recursive: true, force: true });
			}
		},
		30_000,
	);

	test.each([`sha256:${'a'.repeat(64)}`, 'floating:latest', `sha256:${'a'.repeat(64)}\nother=untrusted`])(
		'candidate identity cannot forward a tag or inject workflow outputs (%j)', async (imageID) => {
			const workflow = parse(await Bun.file(new URL('../../../.github/workflows/panel-tests.yml', import.meta.url)).text());
			const identity = workflow.jobs.docker.steps.find((step: { id?: string }) => step.id === 'candidate');
			const workspace = mkdtempSync(join(tmpdir(), 'elygate-identity-test-'));
			try {
				const docker = join(workspace, 'docker');
				const output = join(workspace, 'outputs');
				await Bun.write(docker, '#!/bin/sh\nprintf "%s\\n" "$MOCK_ID"\n');
				chmodSync(docker, 0o700);
				const child = Bun.spawn(['/bin/bash', '-euo', 'pipefail', '-c', identity.run], {
					env: { ...process.env, PATH: `${workspace}:${process.env.PATH}`,
						GITHUB_OUTPUT: output, MOCK_ID: imageID }, stdout: 'pipe', stderr: 'pipe',
				});
				const [status] = await Promise.all([
					child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
				]);
				if (/^sha256:[a-f0-9]{64}$/.test(imageID)) {
					expect(status).toBe(0);
					expect(await Bun.file(output).text()).toBe(`image_id=${imageID}\n`);
				} else {
					expect(status).toBe(2);
					expect(await Bun.file(output).exists()).toBe(false);
				}
			} finally {
				rmSync(workspace, { recursive: true, force: true });
			}
		},
	);

	test('production preflight checks run from the root before panel dependency installation', async () => {
		const workflow = parse(await Bun.file(new URL('../../../.github/workflows/panel-tests.yml', import.meta.url)).text());
		const job = workflow.jobs.panel;
		const steps = job.steps;
		const checkoutIndex = steps.findIndex((step: { name?: string }) => step.name === 'Checkout repository');
		const preflightIndex = steps.findIndex((step: { name?: string }) => step.name === 'Verify production preflight');
		const installIndex = steps.findIndex((step: { name?: string }) => step.name === 'Install dependencies');
		expect(checkoutIndex).toBeGreaterThanOrEqual(0);
		expect(preflightIndex).toBeGreaterThan(checkoutIndex);
		expect(installIndex).toBeGreaterThan(preflightIndex);
		const preflight = steps[preflightIndex];
		expect(preflight.shell).toBe('bash');
		expect(preflight.run.trim().split('\n')).toEqual([
			'bash -n scripts/production/single-node-preflight.sh scripts/production/single-node-preflight.test.sh',
			'shellcheck scripts/production/single-node-preflight.sh scripts/production/single-node-preflight.test.sh',
			'bash scripts/production/single-node-preflight.test.sh',
		]);
		expect(preflight['working-directory'] ?? job.defaults?.run?.['working-directory'] ??
			workflow.defaults?.run?.['working-directory']).toBeUndefined();
		expect(preflight.if).toBeUndefined();
		expect(preflight['continue-on-error']).not.toBe(true);
		expect(job['continue-on-error']).not.toBe(true);
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

	test.each([
		{ name: 'default', requested: '', expected: 'go1.27.3' },
		{ name: 'automatic override', requested: 'auto', expected: 'auto' },
		{ name: 'explicit override', requested: 'go1.27.4', expected: 'go1.27.4' },
	])('local Go wrapper respects the module toolchain: $name', async ({ requested, expected }) => {
		const workspace = mkdtempSync(join(tmpdir(), 'elygate-go-toolchain-'));
		try {
			const executable = join(workspace, 'go');
			await Bun.write(executable, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$GOTOOLCHAIN" "$@"\n');
			chmodSync(executable, 0o755);
			const wrapper = new URL('../../../scripts/go-local.sh', import.meta.url).pathname;
			const child = Bun.spawn(['bash', wrapper, 'version'], {
				env: { ...process.env, PATH: `${workspace}:${process.env.PATH}`, GOTOOLCHAIN: requested },
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const [stdout, stderr, status] = await Promise.all([
				new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
			]);
			expect(stderr).toBe('');
			expect(status).toBe(0);
			expect(stdout).toBe(`${expected}\nversion\n`);
			const coreModule = await Bun.file(new URL('../../../core/go.mod', import.meta.url)).text();
			expect(coreModule).toMatch(/^go 1\.27\.3$/m);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

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
		const employeeIndex = steps.findIndex((step: { name?: string }) => step.name === 'Run employee contracts');
		expect(employeeIndex).toBeGreaterThan(testIndex);
		expect(steps[employeeIndex].run).toBe("bash scripts/go-local.sh test -p 1 ./transports/bifrost-http/employees -run '^Test' -count=1 -timeout=180s");
		const exportIndex = steps.findIndex((step: { name?: string }) => step.name === 'Run usage CSV export regression');
		expect(exportIndex).toBeGreaterThan(employeeIndex);
		expect(steps[exportIndex].run).toBe("bash scripts/go-local.sh test -p 1 ./transports/bifrost-http/controlplane -run '^TestUsageCSVExport' -count=1 -timeout=180s");
		const catalogIndex = steps.findIndex((step: { name?: string }) => step.name === 'Run model catalog audit regressions');
		expect(catalogIndex).toBeGreaterThan(exportIndex);
		expect(steps[catalogIndex].run).toBe("bash scripts/go-local.sh test -p 1 ./transports/bifrost-http/handlers ./transports/bifrost-http/server -run '^TestModelCatalog' -count=1 -timeout=180s");
	});
});
