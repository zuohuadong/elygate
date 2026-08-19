import { describe, expect, test } from 'bun:test';
import {
	buildGovernancePayload,
	buildPricingOverridePayload,
	buildPricingOverrideQuery,
	governanceDraftFromRecord,
	pricingOverrideDraftFromRecord,
} from './governance-management';

describe('governance management helpers', () => {
	test('round-trips team governance and explicitly clears an assignment and rate limit', () => {
		const draft = governanceDraftFromRecord({
			id: 'team-1', name: 'Platform', customer_id: 'customer-1', calendar_aligned: true,
			budgets: [{ id: 'budget-1', max_limit: 120, reset_duration: '1M' }],
			rate_limit: { token_max_limit: 10000, token_reset_duration: '1h' },
		}, 'team');
		draft.customerId = '';
		draft.tokenMaxLimit = '';
		expect(buildGovernancePayload(draft, 'team', true)).toEqual({
			name: 'Platform', customer_id: '', budgets: [{ max_limit: 120, reset_duration: '1M' }],
			rate_limit: {}, calendar_aligned: true,
		});
	});

	test('rejects duplicate budget windows and invalid rate limits', () => {
		const draft = governanceDraftFromRecord({ name: 'Customer' }, 'customer');
		draft.budgets = [
			{ key: '1', maxLimit: 10, resetDuration: '1M' },
			{ key: '2', maxLimit: 20, resetDuration: '1M' },
		];
		expect(() => buildGovernancePayload(draft, 'customer', false)).toThrow('budget-duration-duplicate');
		draft.budgets.pop(); draft.tokenMaxLimit = 1.5;
		expect(() => buildGovernancePayload(draft, 'customer', false)).toThrow('token-limit-invalid');
	});

	test('builds provider governance without leaking provider into the PUT body', () => {
		const draft = governanceDraftFromRecord({ provider: 'anthropic', budgets: [] }, 'provider');
		draft.requestMaxLimit = 100;
		expect(buildGovernancePayload(draft, 'provider', true)).toEqual({
			budgets: [], rate_limit: { request_max_limit: 100, request_reset_duration: '1h' }, calendar_aligned: false,
		});
	});

	test('keeps a calendar-only provider governance payload explicit', () => {
		const draft = governanceDraftFromRecord({ provider: 'anthropic', calendar_aligned: false }, 'provider');
		draft.calendarAligned = true;
		expect(buildGovernancePayload(draft, 'provider', true)).toEqual({
			budgets: [], rate_limit: {}, calendar_aligned: true,
		});
	});

	test('normalizes pricing override scopes and replaces the full numeric patch', () => {
		const draft = pricingOverrideDraftFromRecord({
			name: 'team-price', scope_kind: 'virtual_key_provider', virtual_key_id: 'vk-1', provider_id: 'openai',
			match_type: 'wildcard', pattern: 'gpt-5*', request_types: ['chat_completion'],
			pricing_patch: '{"input_cost_per_token":0.000001}',
		});
		expect(buildPricingOverridePayload(draft)).toEqual({
			name: 'team-price', scope_kind: 'virtual_key_provider', user_id: null, virtual_key_id: 'vk-1',
			provider_id: 'openai', provider_key_id: null, match_type: 'wildcard', pattern: 'gpt-5*',
			request_types: ['chat_completion'], patch: { input_cost_per_token: 0.000001 },
		});
	});

	test('rejects malformed wildcard patterns and encodes list filters', () => {
		const draft = pricingOverrideDraftFromRecord({ name: 'bad', scope_kind: 'global', match_type: 'wildcard', pattern: '*gpt*', request_types: ['chat_completion'], pricing_patch: '{"input_cost_per_token":1}' });
		expect(() => buildPricingOverridePayload(draft)).toThrow('pattern-wildcard');
		expect(buildPricingOverrideQuery({ search: ' GPT ', scopeKind: 'provider', providerId: 'azure/openai', limit: 25, offset: 50 }))
			.toBe('limit=25&offset=50&search=GPT&scope_kind=provider&provider_id=azure%2Fopenai');
	});

	test('requires at least one pricing override request type', () => {
		const draft = pricingOverrideDraftFromRecord({
			name: 'chat-price', scope_kind: 'global', match_type: 'exact', pattern: 'gpt-5',
			request_types: [], pricing_patch: '{"input_cost_per_token":1}',
		});
		expect(() => buildPricingOverridePayload(draft)).toThrow('request-types-required');
	});
});
