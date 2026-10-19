import { getObjectPayload, isJsonRecord, type JsonRecord } from './api';

export interface VectorStoreConfigResponse {
	enabled: boolean;
	type: string;
	config?: {
		connection_string?: { value?: string; ref?: string; type?: string };
		schema?: string;
		path?: string;
	};
	supported: boolean;
	runtime_connected: boolean;
	restart_required: boolean;
	restart_reason?: string;
	editable: boolean;
	managed_by: 'database' | 'config.json';
	management_message?: string;
}

export type VectorStoreDraftType = 'pgvector' | 'sqlite';

export interface VectorStoreDraft {
	enabled: boolean;
	type: VectorStoreDraftType;
	connectionString: string;
	schema: string;
	path: string;
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
		type: config.type === 'sqlite' ? 'sqlite' : 'pgvector',
		connectionString: hasStoredConnection ? '<REDACTED>' : '',
		schema: config.config?.schema?.trim() || 'bifrost_vectors',
		path: config.config?.path?.trim() || '',
	};
}

export function vectorStorePayload(draft: VectorStoreDraft, previous: VectorStoreConfigResponse): JsonRecord {
	if (draft.type === 'sqlite') {
		return {
			enabled: draft.enabled,
			type: 'sqlite',
			config: {
				path: draft.path.trim() || previous.config?.path || '',
			},
		};
	}
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
