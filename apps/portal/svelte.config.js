import adapter from 'svelte-adapter-bun';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		alias: {
			'$lib': 'src/lib',
			'@elygate/db/schema': '../../packages/db/src/schema.ts',
			'@elygate/db/operators': '../../packages/db/src/operators.ts',
			'@elygate/db': '../../packages/db/src/index.ts'
		}
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
