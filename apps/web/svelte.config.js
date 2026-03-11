import adapter from 'svelte-adapter-bun';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
	},
	compilerOptions: {
		warningFilter: (warning) => {
			if (warning.code.startsWith('a11y_')) return false;
			return true;
		}
	}
};

export default config;
