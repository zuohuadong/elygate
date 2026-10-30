import { describe, expect, test } from 'bun:test';
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
			'plugins/logging/**', 'Makefile', 'transports/Dockerfile*', '.github/workflows/panel-tests.yml']) {
			expect(workflow.on.push.paths).toContain(path);
		}
		expect(workflow.on).toHaveProperty('workflow_dispatch');
		expect(workflow.permissions).toEqual({ contents: 'read' });
		expect(workflow.jobs.docker.needs).toBe('panel');
		const imageBuild = workflow.jobs.docker.steps.find((step: { name?: string }) =>
			step.name === 'Build image without publishing');
		expect(imageBuild.with.push).toBe(false);
	});
});
