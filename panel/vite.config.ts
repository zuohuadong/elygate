import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { bundledDocsPlugin } from './vite-docs-plugin.mjs';
import { resolveEnterprisePanelModule } from './vite-enterprise-panel.mjs';

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const enterprisePanelPath = resolveEnterprisePanelModule({
	fallbackPath: new URL('./src/enterprise-fallback/index.ts', import.meta.url).pathname,
	modulePath: runtimeProcess?.env?.BIFROST_ENTERPRISE_PANEL_PATH,
	required: runtimeProcess?.env?.BIFROST_REQUIRE_ENTERPRISE_PANEL === 'true',
});

function stripSvadminSourceDirective(): Plugin {
	return {
		name: 'elygate-strip-svadmin-source-directive',
		enforce: 'pre',
		transform: {
			filter: { id: /@svadmin[\\/]ui.*\.css(?:\?|$)/ },
			handler(code) {
				const cleaned = code.replace(/@source\s+["'][^"']+["'];/g, '');
				return cleaned === code ? undefined : { code: cleaned, map: null };
			},
		},
	};
}

export default defineConfig({
	plugins: [bundledDocsPlugin(), stripSvadminSourceDirective(), tailwindcss(), svelte()],
	server: {
		port: 3000,
		proxy: {
			'/api': {
				target: 'http://localhost:8080',
				changeOrigin: true,
			},
		},
	},
	resolve: {
		alias: {
			'@elygate/enterprise-panel': enterprisePanelPath,
		},
		conditions: ['browser'],
	},
	// svadmin ships Svelte source files, so Vite must transform it directly. Its
	// CommonJS highlighter still needs pre-bundling for a browser-safe default export.
	optimizeDeps: {
		exclude: ['@svadmin/core'],
		include: ['highlight.js'],
	},
	build: {
		outDir: 'out',
		emptyOutDir: true,
	},
});
