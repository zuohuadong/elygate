import { readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const docsRoot = resolve(fileURLToPath(new URL('../docs/', import.meta.url)));
const mediaRoot = resolve(docsRoot, 'media');
const modulePrefix = 'elygate-doc:';
const resolvedPrefix = `\0${modulePrefix}`;
const githubRawPrefix = 'https://github.com/maximhq/bifrost/raw/refs/heads/main/docs/media/';
const assetTokenPrefix = '__ELYGATE_DOC_ASSET_';

function isInside(root, target) {
	const pathFromRoot = relative(root, target);
	return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`);
}

function mediaTarget(target, sourcePath) {
	if (target.startsWith(githubRawPrefix)) return resolve(mediaRoot, target.slice(githubRawPrefix.length));
	if (target.startsWith('/media/')) return resolve(mediaRoot, target.slice('/media/'.length));
	if (/^(?:https?:|data:|#|mailto:|tel:)/u.test(target)) return null;
	return resolve(dirname(resolve(docsRoot, sourcePath)), target);
}

export async function localizeBundledDocMedia(source, sourcePath) {
	const targets = [];
	const patterns = [
		/(!\[[^\]]*\]\()([^)]+)(\))/gu,
		/(<(?:img|source)\b[^>]*\bsrc=["'])([^"']+)(["'])/giu,
	];
	let localizedSource = source;
	for (const pattern of patterns) {
		localizedSource = localizedSource.replace(pattern, (match, prefix, target, suffix) => {
			const filename = mediaTarget(target, sourcePath);
			if (!filename) return match;
			if (!isInside(mediaRoot, filename)) throw new Error(`Bundled documentation media must be inside ${mediaRoot}`);
			const token = `${assetTokenPrefix}${targets.length}__`;
			targets.push({ filename, token });
			return `${prefix}${token}${suffix}`;
		});
	}

	const assets = [];
	for (const target of targets) {
		const filename = await realpath(target.filename);
		if (!isInside(mediaRoot, filename)) throw new Error(`Bundled documentation media must be inside ${mediaRoot}`);
		await readFile(filename);
		assets.push({ ...target, filename });
	}
	return { source: localizedSource, assets };
}

function assetImportPath(filename) {
	return `${pathToFileURL(filename).href}?url`;
}

export function bundledDocsPlugin() {
	return {
		name: 'elygate-bundled-docs',
		enforce: 'pre',
		resolveId(id) {
			return id.startsWith(modulePrefix) ? `${resolvedPrefix}${id.slice(modulePrefix.length)}` : null;
		},
		async load(id) {
			if (!id.startsWith(resolvedPrefix)) return null;
			const sourcePath = id.slice(resolvedPrefix.length);
			const filename = await realpath(resolve(docsRoot, sourcePath));
			if (!isInside(docsRoot, filename)) throw new Error(`Bundled documentation must be inside ${docsRoot}`);
			const source = await readFile(filename, 'utf8');
			const localized = await localizeBundledDocMedia(source, sourcePath);
			const imports = localized.assets.map((asset, index) => `import asset${index} from ${JSON.stringify(assetImportPath(asset.filename))};`).join('\n');
			const replacements = localized.assets.map((asset, index) => `.replace(${JSON.stringify(asset.token)}, asset${index})`).join('');
			return `${imports}\nexport default ${JSON.stringify(localized.source)}${replacements};`;
		},
	};
}
