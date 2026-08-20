import { describe, expect, test } from 'bun:test';
import { buildModelAttributes, displayModelsWithAliases, formatTokenPrice, ModelAttributeError } from './model-catalog';

describe('model catalog helpers', () => {
	test('builds trimmed description and keyed attributes', () => {
		expect(buildModelAttributes('  Fast model  ', [{ key: 'tier', value: 'premium' }, { key: '', value: '' }])).toEqual({
			description: 'Fast model',
			tier: 'premium',
		});
	});

	test('rejects missing, duplicate, and reserved keys', () => {
		for (const [rows, issue] of [
			[[{ key: '', value: 'value' }], 'missing-key'],
			[[{ key: 'tier', value: 'one' }, { key: 'tier', value: 'two' }], 'duplicate-key'],
			[[{ key: 'description', value: 'duplicate field' }], 'reserved-key'],
		] as const) {
			try {
				buildModelAttributes('', [...rows]);
				throw new Error('expected validation to fail');
			} catch (error) {
				expect(error).toBeInstanceOf(ModelAttributeError);
				expect((error as ModelAttributeError).issue).toBe(issue);
			}
		}
	});

	test('replaces raw model identifiers with configured aliases', () => {
		expect(displayModelsWithAliases(['gpt-4o', 'text-embedding-3-small'], [{ aliases: { chat: { model_id: 'gpt-4o' } } }])).toEqual([
			'chat',
			'text-embedding-3-small',
		]);
	});

	test('formats per-token prices per million tokens', () => {
		expect(formatTokenPrice(0.0000025, 'en')).toBe('US$2.50 / 1M');
		expect(formatTokenPrice(undefined, 'en')).toBe('—');
	});
});
