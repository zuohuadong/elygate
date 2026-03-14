import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			'@elygate/db': fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url))
		}
	}
});
