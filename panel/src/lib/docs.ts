function stripMdx(source: string): string {
	return source
		.replace(/^---\s*[\s\S]*?\s*---\s*/u, '')
		.replace(/^\s*(?:import|export)\s.+$/gmu, '')
		.replace(/<\/?[A-Z][^>]*>/gu, '')
		.replace(/\{\/\*[^]*?\*\/\}/gu, '');
}

function normalizeLinks(source: string, sourcePath: string): string {
	const directory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
	const withImages = source.replace(/(!\[[^\]]*\]\()((?!https?:\/\/|data:|\/)[^)]+)(\))/gu, (_match, prefix: string, target: string, suffix: string) =>
		`${prefix}https://raw.githubusercontent.com/maximhq/bifrost/main/docs/${directory}${target}${suffix}`,
	);
	return withImages
		.replace(/(\[[^\]]+\]\()\/(?!\/)([^)]+)(\))/gu, '$1https://docs.getbifrost.ai/$2$3')
		.replace(/(\[[^\]]+\]\()((?!https?:\/\/|#|mailto:|tel:)[^)]+)(\))/gu, (_match, prefix: string, target: string, suffix: string) => {
			const normalizedTarget = target.replace(/\.mdx?(?=$|#|\?)/u, '');
			return `${prefix}${new URL(normalizedTarget, `https://docs.getbifrost.ai/${directory}`).href}${suffix}`;
		});
}

export function normalizeMdxDocument(source: string, sourcePath: string): string {
	return normalizeLinks(stripMdx(source), sourcePath);
}
