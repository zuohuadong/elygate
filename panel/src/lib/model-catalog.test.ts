import { describe, expect, test } from 'bun:test';
import { buildModelAttributes, displayModelsWithAliases, formatTokenPrice, ModelAttributeError, MODEL_GOVERNANCE_KEYS, readModelAttributes } from './model-catalog';

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
		const draft = readModelAttributes(persisted);
		expect(JSON.parse(JSON.stringify(buildModelAttributes(draft.description, draft.rows, draft.governance)))).toEqual(persisted);
		expect(buildModelAttributes('', [])).toEqual({});
	});

	test('round-trips governance annotations without prescribing a taxonomy or rewriting values', () => {
		const persisted = JSON.parse('{"description":"Model","region":" cn-east, eu ","data_class":"internal-L4","capabilities":"custom-feature\\nvision","health":"manual:degraded","__proto__":"retained","custom":""}');
		const draft = readModelAttributes(persisted);
		expect(draft.governance).toEqual({
			region: ' cn-east, eu ', data_class: 'internal-L4',
			capabilities: 'custom-feature\nvision', health: 'manual:degraded',
		});
		expect(draft.rows).toEqual([{ key: '__proto__', value: 'retained' }, { key: 'custom', value: '' }]);
		expect(JSON.parse(JSON.stringify(buildModelAttributes(draft.description, draft.rows, draft.governance)))).toEqual(persisted);
	});

	test('clears governance annotations independently and preserves unrelated attributes', () => {
		const draft = readModelAttributes({ region: 'cn', data_class: 'secret', capabilities: 'chat', health: 'unknown', tier: 'private' });
		draft.governance.region = '';
		draft.governance.health = '';
		expect(buildModelAttributes('', draft.rows, draft.governance)).toEqual({ data_class: 'secret', capabilities: 'chat', tier: 'private' });
		expect(buildModelAttributes('', [], readModelAttributes().governance)).toEqual({});
	});

	test('reads only own values and does not mutate server attributes', () => {
		const persisted = Object.assign(Object.create({ region: 'inherited', health: 'healthy' }), { data_class: 'internal' });
		const draft = readModelAttributes(persisted);
		expect(draft.governance).toEqual({ region: '', data_class: 'internal', capabilities: '', health: '' });
		draft.governance.data_class = 'public';
		expect(persisted.data_class).toBe('internal');
	});

	test.each(MODEL_GOVERNANCE_KEYS)('rejects a custom row shadowing the structured %s field', (key) => {
		expect(() => buildModelAttributes('', [{ key: ` ${key} `, value: 'override' }])).toThrow(ModelAttributeError);
		try {
			buildModelAttributes('', [{ key, value: 'override' }]);
		} catch (error) {
			expect((error as ModelAttributeError).issue).toBe('reserved-key');
			expect((error as ModelAttributeError).key).toBe(key);
		}
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
