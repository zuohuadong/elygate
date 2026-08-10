import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = resolve(fileURLToPath(new URL('../docs/', import.meta.url)));
const modulePrefix = 'elygate-doc:';
const resolvedPrefix = `\0${modulePrefix}`;

export function bundledDocsPlugin() {
	return {
		name: 'elygate-bundled-docs',
		enforce: 'pre',
		resolveId(id) {
			return id.startsWith(modulePrefix) ? `${resolvedPrefix}${id.slice(modulePrefix.length)}` : null;
		},
		async load(id) {
			if (!id.startsWith(resolvedPrefix)) return null;
			const filename = await realpath(resolve(docsRoot, id.slice(resolvedPrefix.length)));
			const pathFromDocs = relative(docsRoot, filename);
			if (pathFromDocs.startsWith(`..${sep}`) || pathFromDocs === '..') {
				throw new Error(`Bundled documentation must be inside ${docsRoot}`);
			}
			const source = await readFile(filename, 'utf8');
			return `export default ${JSON.stringify(source)};`;
		},
	};
}
