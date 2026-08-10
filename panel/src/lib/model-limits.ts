export interface BudgetDraft {
	id?: string;
	maxLimit: string;
	resetDuration: string;
}

export interface ModelLimitDraft {
	modelName: string;
	provider: string;
	scope: string;
	scopeId: string;
	budgets: BudgetDraft[];
	tokenMaxLimit: string;
	tokenResetDuration: string;
	requestMaxLimit: string;
	requestResetDuration: string;
}

export type ModelLimitIssue = 'model-required' | 'scope-required' | 'invalid-limit' | 'duplicate-duration' | 'limit-required';

export class ModelLimitError extends Error {
	public constructor(public readonly issue: ModelLimitIssue) {
		super(issue);
		this.name = 'ModelLimitError';
	}
}

function optionalLimit(value: string): number | undefined {
	if (!value.trim()) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) throw new ModelLimitError('invalid-limit');
	return parsed;
}

export function buildModelLimitPayload(draft: ModelLimitDraft, hadRateLimit = false): Record<string, unknown> {
	const modelName = draft.modelName.trim();
	if (!modelName) throw new ModelLimitError('model-required');
	if (draft.scope !== 'global' && !draft.scopeId.trim()) throw new ModelLimitError('scope-required');

	const budgets = draft.budgets
		.filter((budget) => budget.maxLimit.trim() !== '')
		.map((budget) => ({
			...(budget.id ? { id: budget.id } : {}),
			max_limit: optionalLimit(budget.maxLimit) as number,
			reset_duration: budget.resetDuration || '1M',
		}));
	if (new Set(budgets.map((budget) => budget.reset_duration)).size !== budgets.length) throw new ModelLimitError('duplicate-duration');

	const tokenMaxLimit = optionalLimit(draft.tokenMaxLimit);
	const requestMaxLimit = optionalLimit(draft.requestMaxLimit);
	if (budgets.length === 0 && tokenMaxLimit === undefined && requestMaxLimit === undefined) throw new ModelLimitError('limit-required');

	let rateLimit: Record<string, unknown> | undefined;
	if (tokenMaxLimit !== undefined || requestMaxLimit !== undefined) {
		rateLimit = {
			...(tokenMaxLimit !== undefined ? { token_max_limit: tokenMaxLimit, token_reset_duration: draft.tokenResetDuration || '1h' } : {}),
			...(requestMaxLimit !== undefined ? { request_max_limit: requestMaxLimit, request_reset_duration: draft.requestResetDuration || '1h' } : {}),
		};
	} else if (hadRateLimit) {
		rateLimit = {};
	}

	return {
		model_name: modelName,
		...(draft.provider.trim() ? { provider: draft.provider.trim() } : {}),
		scope: draft.scope || 'global',
		...(draft.scope !== 'global' ? { scope_id: draft.scopeId.trim() } : {}),
		budgets,
		...(rateLimit !== undefined ? { rate_limit: rateLimit } : {}),
	};
}
