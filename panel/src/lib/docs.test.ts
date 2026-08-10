import { describe, expect, test } from 'bun:test';
import { bundledDocsPlugin } from '../../vite-docs-plugin.mjs';
import { normalizeMdxDocument } from './docs';

describe('bundled documentation', () => {
	test('strips MDX wrappers and sends internal links to the documentation site', () => {
		const source = `---\ntitle: Test\n---\n<Note>Read [next](./next.mdx#part).</Note>\n![diagram](../../media/test.png)`;
		const normalized = normalizeMdxDocument(source, 'quickstart/gateway/setting-up.mdx');
		expect(normalized).not.toContain('<Note>');
		expect(normalized).not.toContain('title: Test');
		expect(normalized).toContain('https://docs.getbifrost.ai/quickstart/gateway/next#part');
		expect(normalized).toContain('https://raw.githubusercontent.com/maximhq/bifrost/main/docs/quickstart/gateway/../../media/test.png');
	});

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
	});
});
