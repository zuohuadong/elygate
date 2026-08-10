import { describe, expect, test } from 'bun:test';
import { buildModelLimitPayload, ModelLimitError, type ModelLimitDraft } from './model-limits';

const base: ModelLimitDraft = {
	modelName: 'gpt-4o', provider: 'openai', scope: 'global', scopeId: '', budgets: [],
	tokenMaxLimit: '', tokenResetDuration: '1h', requestMaxLimit: '', requestResetDuration: '1h',
};

describe('model limit payload', () => {
	test('builds budgets and both rate-limit dimensions', () => {
		expect(buildModelLimitPayload({
			...base,
			budgets: [{ maxLimit: '25.5', resetDuration: '1M' }],
			tokenMaxLimit: '10000',
			requestMaxLimit: '200',
		})).toEqual({
			model_name: 'gpt-4o', provider: 'openai', scope: 'global',
			budgets: [{ max_limit: 25.5, reset_duration: '1M' }],
			rate_limit: { token_max_limit: 10000, token_reset_duration: '1h', request_max_limit: 200, request_reset_duration: '1h' },
		});
	});

	test('requires a scope target and at least one limit', () => {
		for (const [draft, issue] of [
			[{ ...base, scope: 'virtual_key', budgets: [{ maxLimit: '1', resetDuration: '1M' }] }, 'scope-required'],
			[base, 'limit-required'],
		] as const) {
			try {
				buildModelLimitPayload(draft);
				throw new Error('expected validation to fail');
			} catch (error) {
				expect(error).toBeInstanceOf(ModelLimitError);
				expect((error as ModelLimitError).issue).toBe(issue);
			}
		}
	});

	test('rejects duplicate budget periods', () => {
		expect(() => buildModelLimitPayload({ ...base, budgets: [{ maxLimit: '1', resetDuration: '1d' }, { maxLimit: '2', resetDuration: '1d' }] })).toThrow(ModelLimitError);
	});
});
