import adapter from 'svelte-adapter-bun';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
        alias: {
            '$components': 'src/components',
            '$lib': 'src/lib'
        }
	},
	compilerOptions: {
		warningFilter: (warning) => {
			if (warning.code.startsWith('a11y_')) return false;
			return true;
		}
	}
};

export default config;
