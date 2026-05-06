import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const dbBase = fileURLToPath(new URL('../../packages/db/src', import.meta.url));

// Shim the `bun` built-in during Vite build so that SvelteKit's Node-based
// post-build analysis can load the output chunks without crashing.
// At runtime the real Bun runtime provides these globals.
function bunShim(): Plugin {
	const shimModule = `
export class SQL {
	constructor(urlOrConfig, config) {
		this.options = {};
	}
	prepare() { return this; }
	run() { return []; }
	all() { return []; }
	get() { return null; }
	execute() { return []; }
	values() { return []; }
}
export { SQL as default };
export const CryptoHasher = class {
	constructor() {}
	update() { return this; }
	digest() { return ''; }
};
`;
	return {
		name: 'bun-shim',
		enforce: 'pre',
		resolveId(id) {
			if (id === 'bun' || id === 'node:bun') return '\0virtual:bun-shim';
		},
		load(id) {
			if (id === '\0virtual:bun-shim') return shimModule;
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), bunShim()],
	resolve: {
		alias: [
			{ find: '@elygate/db/schema', replacement: `${dbBase}/schema.ts` },
			{ find: '@elygate/db/operators', replacement: `${dbBase}/operators.ts` },
			{ find: '@elygate/db', replacement: `${dbBase}/index.ts` },
		]
	}
});
