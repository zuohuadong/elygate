import { describe, expect, test } from 'bun:test';
import { buildModelAttributes, displayModelsWithAliases, formatTokenPrice, ModelAttributeError } from './model-catalog';

describe('model catalog helpers', () => {
	test('builds trimmed description and keyed attributes', () => {
		expect(buildModelAttributes('  Fast model  ', [{ key: 'tier', value: 'premium' }, { key: '', value: '' }])).toEqual({
			description: 'Fast model',
			tier: 'premium',
		});
	});

	test.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])(
		'preserves the custom attribute %s as an own JSON property', (key) => {
			const attributes = buildModelAttributes('Model description', [{ key: ` ${key} `, value: ' retained ' }]);
			expect(Object.hasOwn(attributes, key)).toBe(true);
			expect(attributes[key]).toBe(' retained ');
			expect(Object.getPrototypeOf(attributes)).toBeNull();
			expect(JSON.parse(JSON.stringify(attributes))).toEqual(
				JSON.parse(`{"description":"Model description","${key}":" retained "}`),
			);
		},
	);

	test('round-trips server attributes without losing prototype-named or empty values', () => {
		const persisted = JSON.parse('{"description":"Model description","__proto__":"restricted","constructor":"","region":"cn"}');
		const rows = Object.entries(persisted as Record<string, string>)
			.filter(([key]) => key !== 'description')
			.map(([key, value]) => ({ key, value }));
		expect(JSON.parse(JSON.stringify(buildModelAttributes(persisted.description, rows)))).toEqual(persisted);
		expect(buildModelAttributes('', [])).toEqual({});
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
		expect(formatTokenPrice(0.0000025, 'en')).toBe('$2.50 / 1M');
		expect(formatTokenPrice(undefined, 'en')).toBe('—');
	});
});
