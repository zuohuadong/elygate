import { describe, expect, test } from 'bun:test';
import { buildRoutingFallbacks, routingFallbackDrafts } from './routing-rules';

describe('routing rule fallbacks', () => {
	test('round-trips legacy string fallbacks unchanged', () => {
		expect(routingFallbackDrafts(['openai/gpt-4o', 'azure/'])).toEqual([
			{ value: 'openai/gpt-4o', keyId: '' },
			{ value: 'azure/', keyId: '' },
		]);
		expect(buildRoutingFallbacks(routingFallbackDrafts(['openai/gpt-4o', 'azure/']))).toEqual(['openai/gpt-4o', 'azure/']);
	});

	test('preserves a key-pinned fallback object through an edit', () => {
		const original = [{ provider: 'azure', model: 'backup', key_id: 'fallback-pin' }];
		const drafts = routingFallbackDrafts(original);
		expect(drafts).toEqual([{ value: 'azure/backup', keyId: 'fallback-pin' }]);
		expect(buildRoutingFallbacks(drafts)).toEqual(original);
	});

	test('preserves an incoming-model fallback object with no model', () => {
		expect(routingFallbackDrafts([{ provider: 'azure', model: '', key_id: 'pin' }])).toEqual([{ value: 'azure/', keyId: 'pin' }]);
	});

	test('drops blank drafts and ignores malformed entries', () => {
		expect(buildRoutingFallbacks([{ value: '   ', keyId: '' }, { value: 'openai/gpt-4o', keyId: '' }])).toEqual(['openai/gpt-4o']);
		expect(routingFallbackDrafts([null, 42, {}, { model: 'only-model' }])).toEqual([{ value: 'only-model', keyId: '' }]);
	});

	test('rejects a key-pinned fallback without a provider prefix', () => {
		expect(() => buildRoutingFallbacks([{ value: 'gpt-4o', keyId: 'key-1' }])).toThrow(/provider\/model/);
	});

	test('submits fallback payloads instead of rule IDs', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();
		expect(source).toContain('buildRoutingFallbacks(formSnapshot.fallbacks)');
		expect(source).toContain("placeholder=\"openai/gpt-4o\"");
		expect(source).toContain('bind:value={fallback.keyId}');
		expect(source).not.toContain('function toggleFallback');
		expect(source).not.toContain('rules.filter((rule) => rule.id !== editing?.id)');
	});
});
