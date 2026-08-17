import { describe, expect, test } from 'bun:test';
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
		expect(dockerfile).toContain('COPY docs/ /docs/');
		expect(dockerfile.match(/apk add --no-cache[^\n]*git/g)).toHaveLength(2);
	});
});
