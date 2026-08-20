export interface ModelAttributeRow {
	key: string;
	value: string;
}

export type ModelAttributeIssue = 'missing-key' | 'duplicate-key' | 'reserved-key';

export class ModelAttributeError extends Error {
	public constructor(
		public readonly issue: ModelAttributeIssue,
		public readonly key = '',
	) {
		super(issue);
		this.name = 'ModelAttributeError';
	}
}

export function buildModelAttributes(description: string, rows: ModelAttributeRow[]): Record<string, string> {
	const cleaned = rows
		.map((row) => ({ key: row.key.trim(), value: row.value }))
		.filter((row) => row.key !== '' || row.value !== '');

	if (cleaned.some((row) => row.key === '')) throw new ModelAttributeError('missing-key');

	const seen = new Set<string>();
	for (const row of cleaned) {
		if (row.key === 'description') throw new ModelAttributeError('reserved-key', row.key);
		if (seen.has(row.key)) throw new ModelAttributeError('duplicate-key', row.key);
		seen.add(row.key);
	}

	const attributes: Record<string, string> = {};
	const normalizedDescription = description.trim();
	if (normalizedDescription) attributes.description = normalizedDescription;
	for (const row of cleaned) attributes[row.key] = row.value;
	return attributes;
}

export function displayModelsWithAliases(models: string[], keys: unknown[]): string[] {
	const aliasesByModel = new Map<string, string[]>();
	for (const value of keys) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const aliases = (value as Record<string, unknown>).aliases;
		if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) continue;
		for (const [alias, rawConfig] of Object.entries(aliases)) {
			const targets = typeof rawConfig === 'string'
				? [rawConfig]
				: rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
					? [(rawConfig as Record<string, unknown>).model_id, (rawConfig as Record<string, unknown>).model_name]
					: [];
			for (const target of targets) {
				if (typeof target !== 'string' || !target) continue;
				const names = aliasesByModel.get(target) ?? [];
				if (!names.includes(alias)) aliasesByModel.set(target, [...names, alias]);
			}
		}
	}
	return models.flatMap((model) => aliasesByModel.get(model) ?? [model]);
}

export function formatTokenPrice(value: unknown, locale: string): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
	const amount = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value * 1_000_000);
	return `US$${amount} / 1M`;
}
