import { withBasePath } from './base-path';

function stripMdx(source: string): string {
	return source
		.replace(/^---\s*[\s\S]*?\s*---\s*/u, '')
		.replace(/^\s*(?:import|export)\s.+$/gmu, '')
		.replace(/<\/?[A-Z][^>]*>/gu, '')
		.replace(/\{\/\*[^]*?\*\/\}/gu, '');
}

function normalizeLinks(source: string, sourcePath: string): string {
	const directory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
	return source
		.replace(/(\[[^\]]+\]\()\/(?!\/|assets\/)([^)]+)(\))/gu, '$1https://docs.getbifrost.ai/$2$3')
		.replace(/(\[[^\]]+\]\()((?!https?:\/\/|\/assets\/|#|mailto:|tel:)[^)]+)(\))/gu, (_match, prefix: string, target: string, suffix: string) => {
			const normalizedTarget = target.replace(/\.mdx?(?=$|#|\?)/u, '');
			return `${prefix}${new URL(normalizedTarget, `https://docs.getbifrost.ai/${directory}`).href}${suffix}`;
		});
}

export function applyMediaLoadingHints(html: string): string {
	return html
		.replace(/<img(?![^>]*\bloading=)/giu, '<img loading="lazy" decoding="async"')
		.replace(/<video(?![^>]*\bpreload=)/giu, '<video preload="metadata"');
}

// Bundled doc media is emitted by Vite as root-absolute /assets/... URLs inside
// the JS bundle, which the gateway's shell-only base_path rewrite cannot see.
// Prefix it at render time when the dashboard is mounted under /bifrost.
export function prefixBundledMediaUrls(html: string, base = withBasePath('/assets/')): string {
	if (base === '/assets/') return html;
	return html.replace(/(\b(?:src|href|poster)=["'])\/assets\//giu, `$1${base}`);
}

export function normalizeMdxDocument(source: string, sourcePath: string): string {
	return normalizeLinks(stripMdx(source), sourcePath);
}
