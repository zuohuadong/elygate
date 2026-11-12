import { isJsonRecord } from './api';

export interface RoutingFallbackDraft {
	value: string;
	keyId: string;
}

export interface RoutingFallbackObjectPayload {
	provider: string;
	model: string;
	key_id: string;
}

export type RoutingFallbackPayload = string | RoutingFallbackObjectPayload;

/**
 * The routing API accepts both the legacy "provider/model" string and an object
 * that pins a provider key. The editor keeps both shapes in one draft so saving
 * an existing key-pinned fallback cannot silently drop its key_id.
 */
export function routingFallbackDrafts(value: unknown): RoutingFallbackDraft[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item): RoutingFallbackDraft[] => {
		if (typeof item === 'string') {
			const trimmed = item.trim();
			return trimmed ? [{ value: item, keyId: '' }] : [];
		}
		if (!isJsonRecord(item)) return [];
		const provider = typeof item.provider === 'string' ? item.provider : '';
		const model = typeof item.model === 'string' ? item.model : '';
		const keyId = typeof item.key_id === 'string' ? item.key_id : '';
		const rendered = provider ? (model ? `${provider}/${model}` : `${provider}/`) : model;
		return rendered ? [{ value: rendered, keyId }] : [];
	});
}

export function buildRoutingFallbacks(drafts: RoutingFallbackDraft[]): RoutingFallbackPayload[] {
	const payload: RoutingFallbackPayload[] = [];
	for (const draft of drafts) {
		const value = draft.value.trim();
		if (!value) continue;
		const keyId = draft.keyId.trim();
		if (!keyId) {
			payload.push(value);
			continue;
		}
		const slash = value.indexOf('/');
		if (slash <= 0) {
			throw new Error(`Fallback "${value}" must use provider/model form when a key ID is set.`);
		}
		payload.push({
			provider: value.slice(0, slash),
			model: value.slice(slash + 1),
			key_id: keyId,
		});
	}
	return payload;
}
