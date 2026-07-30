import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

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
	plugins: [stripSvadminSourceDirective(), tailwindcss(), svelte()],
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
