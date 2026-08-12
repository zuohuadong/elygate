import { getObjectPayload, isJsonRecord, type JsonRecord } from './api';

export interface VectorStoreConfigResponse {
	enabled: boolean;
	type: string;
	config?: {
		connection_string?: { value?: string; ref?: string; type?: string };
		schema?: string;
	};
	supported: boolean;
	runtime_connected: boolean;
	restart_required: boolean;
	restart_reason?: string;
	editable: boolean;
	managed_by: 'database' | 'config.json';
	management_message?: string;
}

export interface VectorStoreDraft {
	enabled: boolean;
	connectionString: string;
	schema: string;
}

export function pluginFromMutationResponse(value: unknown): JsonRecord {
	const plugin = getObjectPayload(value, 'plugin');
	if (!isJsonRecord(plugin) || typeof plugin.name !== 'string') throw new Error('invalid-plugin-response');
	return plugin;
}

export function pluginConfigForMutation(enabled: boolean, storedConfig: unknown, buildDraft: () => JsonRecord): JsonRecord {
	if (!enabled && isJsonRecord(storedConfig)) return storedConfig;
	return buildDraft();
}

export function vectorStoreDraft(config: VectorStoreConfigResponse): VectorStoreDraft {
	const connection = config.config?.connection_string;
	const hasStoredConnection = Boolean(connection && (connection.value || connection.ref));
	return {
		enabled: config.enabled,
		connectionString: hasStoredConnection ? '<REDACTED>' : '',
		schema: config.config?.schema?.trim() || 'bifrost_vectors',
	};
}

export function vectorStorePayload(draft: VectorStoreDraft, previous: VectorStoreConfigResponse): JsonRecord {
	const connectionString = draft.connectionString.trim();
	return {
		enabled: draft.enabled,
		type: 'pgvector',
		config: {
			connection_string: connectionString === '<REDACTED>' ? previous.config?.connection_string : { value: connectionString },
			schema: draft.schema.trim() || 'bifrost_vectors',
		},
	};
}
