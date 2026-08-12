import { describe, expect, test } from 'bun:test';
import { pluginConfigForMutation, pluginFromMutationResponse, vectorStoreDraft, vectorStorePayload } from './caching-config';

describe('caching plugin mutations', () => {
	test('unwraps the plugin returned by create and update responses', () => {
		const enabled = pluginFromMutationResponse({ message: 'updated', plugin: { name: 'semantic_cache', enabled: true, config: { ttl: 30 } } });
		expect(enabled.name).toBe('semantic_cache');
		expect(enabled.enabled).toBe(true);

		const disabled = pluginFromMutationResponse({ message: 'updated', plugin: { name: 'semantic_cache', enabled: false, config: { ttl: 30 } } });
		expect(disabled.enabled).toBe(false);
	});

	test('rejects acknowledgement-only responses instead of silently disabling the editor', () => {
		expect(() => pluginFromMutationResponse({ message: 'updated' })).toThrow('invalid-plugin-response');
	});

	test('preserves a redacted pgvector connection string when only the schema changes', () => {
		const previous = {
			enabled: true,
			type: 'pgvector' as const,
			supported: true,
			config: { connection_string: { value: '<REDACTED>' }, schema: 'old_vectors' },
			runtime_connected: false,
			restart_required: false,
			editable: true,
			managed_by: 'database' as const,
		};
		const draft = vectorStoreDraft(previous);
		expect(vectorStorePayload({ ...draft, schema: 'new_vectors' }, previous)).toEqual({
			enabled: true,
			type: 'pgvector',
			config: { connection_string: { value: '<REDACTED>' }, schema: 'new_vectors' },
		});
	});

	test('preserves a secret reference without exposing its resolved value', () => {
		const previous = {
			enabled: true,
			type: 'pgvector' as const,
			supported: true,
			config: { connection_string: { value: '', ref: 'env.PGVECTOR_DSN', type: 'env' }, schema: 'bifrost_vectors' },
			runtime_connected: true,
			restart_required: false,
			editable: true,
			managed_by: 'database' as const,
		};
		const draft = vectorStoreDraft(previous);
		expect(draft.connectionString).toBe('<REDACTED>');
		expect(vectorStorePayload(draft, previous).config).toEqual({
			connection_string: previous.config.connection_string,
			schema: 'bifrost_vectors',
		});
	});

	test('does not present an empty plaintext secret as an existing connection', () => {
		const config = {
			enabled: false,
			type: 'pgvector' as const,
			supported: true,
			config: { connection_string: { value: '', type: 'plain_text' }, schema: 'bifrost_vectors' },
			runtime_connected: false,
			restart_required: false,
			editable: true,
			managed_by: 'database' as const,
		};

		expect(vectorStoreDraft(config).connectionString).toBe('');
	});

	test('disables a broken plugin without validating the editor draft', () => {
		const storedConfig = { ttl: -1, threshold: 2 };
		let draftBuilt = false;
		const selected = pluginConfigForMutation(false, storedConfig, () => {
			draftBuilt = true;
			throw new Error('invalid editor draft');
		});

		expect(selected).toEqual(storedConfig);
		expect(draftBuilt).toBe(false);
	});
});
