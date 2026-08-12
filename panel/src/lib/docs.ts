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

export function normalizeMdxDocument(source: string, sourcePath: string): string {
	return normalizeLinks(stripMdx(source), sourcePath);
}
