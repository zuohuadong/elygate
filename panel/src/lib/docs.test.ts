import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledDocsPlugin, localizeBundledDocMedia } from '../../vite-docs-plugin.mjs';
import { applyMediaLoadingHints, normalizeMdxDocument } from './docs';

describe('bundled documentation', () => {
	const bundledSourcePaths = [
		'quickstart/gateway/setting-up.mdx',
		'architecture/core/request-flow.mdx',
		'mcp/overview.mdx',
		'mcp/gateway.mdx',
		'features/governance/virtual-keys.mdx',
		'features/governance/routing.mdx',
		'features/webhooks.mdx',
		'plugins/getting-started.mdx',
		'deployment-guides/how-to/security-best-practices.mdx',
	];

	test('strips MDX wrappers and sends internal links to the documentation site', () => {
		const source = `---\ntitle: Test\n---\n<Note>Read [next](./next.mdx#part).</Note>\n![diagram](/assets/docs/test.png)`;
		const normalized = normalizeMdxDocument(source, 'quickstart/gateway/setting-up.mdx');
		expect(normalized).not.toContain('<Note>');
		expect(normalized).not.toContain('title: Test');
		expect(normalized).toContain('https://docs.getbifrost.ai/quickstart/gateway/next#part');
		expect(normalized).toContain('![diagram](/assets/docs/test.png)');
	});

	test('localizes markdown, root media, and GitHub raw media to the bundled asset closure', async () => {
		const source = [
			'![gateway](../../media/getting-started.png)',
			'<img src="/media/ui-config.png" />',
			'<source src="https://github.com/maximhq/bifrost/raw/refs/heads/main/docs/media/run-npx.mp4" type="video/mp4" />',
			'![external](https://example.com/diagram.png)',
		].join('\n');
		const localized = await localizeBundledDocMedia(source, 'quickstart/gateway/setting-up.mdx');
		expect(localized.assets).toHaveLength(3);
		expect(localized.source).not.toContain('raw/refs/heads/main/docs/media');
		expect(localized.source).toContain('https://example.com/diagram.png');
		expect(localized.source.match(/__ELYGATE_DOC_ASSET_/g)).toHaveLength(3);
	});

	test('adds lazy image and metadata video loading hints', () => {
		const html = applyMediaLoadingHints('<img src="/assets/a.png"><video controls><source src="/assets/a.mp4"></video>');
		expect(html).toContain('<img loading="lazy" decoding="async"');
		expect(html).toContain('<video preload="metadata"');
	});

	test('rejects media paths that escape the bundled documentation media root', async () => {
		await expect(localizeBundledDocMedia('![escape](../../../README.md)', 'quickstart/gateway/setting-up.mdx')).rejects.toThrow(
			'Bundled documentation media must be inside',
		);
	});

	test('keeps the Docker build context in sync with the exact bundled media closure', async () => {
		const referencedMedia = new Set<string>();
		const mediaRoot = fileURLToPath(new URL('../../../docs/media/', import.meta.url));
		for (const sourcePath of bundledSourcePaths) {
			const source = await readFile(new URL(`../../../docs/${sourcePath}`, import.meta.url), 'utf8');
			const localized = await localizeBundledDocMedia(source, sourcePath);
			for (const asset of localized.assets) {
				const mediaPath = relative(mediaRoot, asset.filename).split(sep).join('/');
				expect(mediaPath).not.toStartWith('../');
				referencedMedia.add(`!docs/media/${mediaPath}`);
			}
		}

		const dockerignore = await readFile(new URL('../../../.dockerignore', import.meta.url), 'utf8');
		const lines = dockerignore.split(/\r?\n/u).map((line) => line.trim());
		const excludedDocsIndex = lines.indexOf('docs/**');
		const mediaParentIndex = lines.indexOf('!docs/media/');
		const excludedMediaIndex = lines.indexOf('docs/media/**');
		const allowlist = lines
			.map((line) => line.trim())
			.filter((line) => line.startsWith('!docs/media/'));
		expect(excludedDocsIndex).toBeGreaterThanOrEqual(0);
		expect(mediaParentIndex).toBeGreaterThan(excludedDocsIndex);
		expect(excludedMediaIndex).toBeGreaterThan(mediaParentIndex);
		expect(allowlist).not.toContain('!docs/media/**');
		expect(allowlist).not.toContain('!docs/media/*');
		for (const entry of allowlist.filter((line) => line !== '!docs/media/')) {
			expect(lines.indexOf(entry)).toBeGreaterThan(excludedMediaIndex);
		}
		expect(allowlist.filter((line) => line !== '!docs/media/').sort()).toEqual([...referencedMedia].sort());
		expect(referencedMedia.size).toBe(20);
	}, 30_000);

	test('loads non-empty documentation through the isolated Vite module', async () => {
		const plugin = bundledDocsPlugin() as unknown as {
			resolveId: (id: string) => string | null;
			load: (id: string) => Promise<string | null>;
		};
		const resolvedId = plugin.resolveId('elygate-doc:quickstart/gateway/setting-up.mdx');
		expect(resolvedId).not.toBeNull();
		const moduleSource = await plugin.load(resolvedId ?? '');
		expect(moduleSource).toContain('30-Second Setup');
		expect(moduleSource?.length ?? 0).toBeGreaterThan(1000);
		expect(moduleSource).toContain('?url');
		expect(moduleSource).not.toContain('https://github.com/maximhq/bifrost/raw/refs/heads/main/docs/media/run-npx.mp4');
	});
});
