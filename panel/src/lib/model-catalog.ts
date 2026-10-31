export interface ModelAttributeRow {
	key: string;
	value: string;
}

export const MODEL_GOVERNANCE_KEYS = ['region', 'data_class', 'capabilities', 'health'] as const;
export type ModelGovernanceKey = typeof MODEL_GOVERNANCE_KEYS[number];
export type ModelGovernanceFields = Record<ModelGovernanceKey, string>;

export function readModelAttributes(attributes: Record<string, string> = {}): {
	description: string;
	governance: ModelGovernanceFields;
	rows: ModelAttributeRow[];
} {
	const ownValue = (key: string): string => Object.hasOwn(attributes, key) ? attributes[key] : '';
	return {
		description: ownValue('description'),
		governance: {
			region: ownValue('region'),
			data_class: ownValue('data_class'),
			capabilities: ownValue('capabilities'),
			health: ownValue('health'),
		},
		rows: Object.entries(attributes)
			.filter(([key]) => key !== 'description' && !MODEL_GOVERNANCE_KEYS.some((reserved) => reserved === key))
			.map(([key, value]) => ({ key, value })),
	};
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

export function buildModelAttributes(
	description: string,
	rows: ModelAttributeRow[],
	governance: ModelGovernanceFields = readModelAttributes().governance,
): Record<string, string> {
	const cleaned = rows
		.map((row) => ({ key: row.key.trim(), value: row.value }))
		.filter((row) => row.key !== '' || row.value !== '');

	if (cleaned.some((row) => row.key === '')) throw new ModelAttributeError('missing-key');

	const seen = new Set<string>();
	for (const row of cleaned) {
		if (row.key === 'description' || MODEL_GOVERNANCE_KEYS.some((reserved) => reserved === row.key)) {
			throw new ModelAttributeError('reserved-key', row.key);
		}
		if (seen.has(row.key)) throw new ModelAttributeError('duplicate-key', row.key);
		seen.add(row.key);
	}

	const attributes = Object.create(null) as Record<string, string>;
	const normalizedDescription = description.trim();
	if (normalizedDescription) attributes.description = normalizedDescription;
	for (const key of MODEL_GOVERNANCE_KEYS) {
		if (governance[key] !== '') attributes[key] = governance[key];
	}
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
	return `$${amount} / 1M`;
}
