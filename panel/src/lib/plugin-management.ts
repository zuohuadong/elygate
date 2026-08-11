import { isJsonRecord, type JsonRecord } from './api';

export const PLUGIN_CAPABILITIES_CHANGED_EVENT = 'elygate:plugin-capabilities-changed';

export type PluginPlacement = 'pre_builtin' | 'post_builtin';
export type PluginKind = 'builtin' | 'custom';

export interface PluginStatus {
	name: string;
	status: string;
	types: string[];
	logs: string[];
}

export interface ManagedPlugin {
	name: string;
	actualName: string;
	description: string;
	descriptionZh: string;
	features: string[];
	enabled: boolean;
	config: JsonRecord;
	isCustom: boolean;
	path: string;
	placement: PluginPlacement;
	order: number;
	status: PluginStatus;
}

export interface PluginDraft {
	name: string;
	kind: PluginKind;
	path: string;
	enabled: boolean;
	configJson: string;
	placement: PluginPlacement;
	order: string | number;
}

export interface PluginMutationPayload {
	enabled: boolean;
	config: JsonRecord;
	path?: string;
	placement: PluginPlacement;
	order: number;
}

export interface CreatePluginPayload extends PluginMutationPayload {
	name: string;
}

export type PluginSequenceItem =
	| { id: '__builtin__'; kind: 'builtin' }
	| { id: string; kind: 'plugin'; plugin: ManagedPlugin };

export interface PluginSequenceUpdate {
	name: string;
	payload: PluginMutationPayload;
}

export interface PluginModalBackdropPress {
	targetIsBackdrop: boolean;
	button: number;
	isSaving: boolean;
}

const PLUGIN_NAME = /^[A-Za-z0-9_-]+$/;

export function shouldClosePluginModalFromBackdrop(press: PluginModalBackdropPress): boolean {
	return press.targetIsBackdrop && press.button === 0 && !press.isSaving;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function integer(value: string | number, fallback: number): number {
	const raw = String(value).trim();
	if (!raw) return fallback;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0) throw new Error('order-invalid');
	return parsed;
}

function parseConfig(value: string): JsonRecord {
	const raw = value.trim();
	if (!raw) return {};
	const parsed: unknown = JSON.parse(raw);
	if (!isJsonRecord(parsed)) throw new Error('config-object');
	return parsed;
}

function pathFor(draft: PluginDraft): string | undefined {
	if (draft.kind === 'builtin') return undefined;
	const path = draft.path.trim();
	if (!path) throw new Error('path-required');
	if (!path.startsWith('/') && !path.startsWith('http://') && !path.startsWith('https://')) throw new Error('path-invalid');
	return path;
}

export function managedPluginFromRecord(record: JsonRecord): ManagedPlugin {
	const status = isJsonRecord(record.status) ? record.status : {};
	const placement = record.placement === 'pre_builtin' ? 'pre_builtin' : 'post_builtin';
	return {
		name: typeof record.name === 'string' ? record.name : '',
		actualName: typeof record.actualName === 'string' ? record.actualName : typeof status.name === 'string' ? status.name : '',
		description: typeof record.description === 'string' ? record.description : '',
		descriptionZh: typeof record.descriptionZh === 'string' ? record.descriptionZh : '',
		features: stringList(record.features),
		enabled: record.enabled === true,
		config: isJsonRecord(record.config) ? record.config : {},
		isCustom: record.isCustom === true,
		path: typeof record.path === 'string' ? record.path : '',
		placement,
		order: typeof record.order === 'number' && Number.isInteger(record.order) && record.order >= 0 ? record.order : 0,
		status: {
			name: typeof status.name === 'string' ? status.name : '',
			status: typeof status.status === 'string' ? status.status : record.enabled === false ? 'disabled' : 'uninitialized',
			types: stringList(status.types),
			logs: stringList(status.logs),
		},
	};
}

export function activePluginFeatures(plugins: ManagedPlugin[]): string[] {
	const features = plugins
		.filter((plugin) => plugin.enabled && plugin.status.status === 'active')
		.flatMap((plugin) => plugin.features);
	return [...new Set(features)].sort();
}

export function emptyPluginDraft(builtinNames: string[] = []): PluginDraft {
	return {
		name: builtinNames[0] ?? '',
		kind: builtinNames.length > 0 ? 'builtin' : 'custom',
		path: '',
		enabled: true,
		configJson: '{}',
		placement: 'post_builtin',
		order: 0,
	};
}

export function pluginDraftFromRecord(plugin: ManagedPlugin): PluginDraft {
	return {
		name: plugin.name,
		kind: plugin.isCustom ? 'custom' : 'builtin',
		path: plugin.path,
		enabled: plugin.enabled,
		configJson: JSON.stringify(plugin.config, null, 2),
		placement: plugin.placement,
		order: plugin.order,
	};
}

export function buildPluginMutationPayload(draft: PluginDraft): PluginMutationPayload {
	return {
		enabled: draft.enabled,
		config: parseConfig(draft.configJson),
		path: pathFor(draft),
		placement: draft.placement,
		order: integer(draft.order, 0),
	};
}

export function buildCreatePluginPayload(draft: PluginDraft): CreatePluginPayload {
	const name = draft.name.trim();
	if (!name) throw new Error('name-required');
	if (!PLUGIN_NAME.test(name)) throw new Error('name-invalid');
	return { name, ...buildPluginMutationPayload(draft) };
}

export function buildPluginSequence(plugins: ManagedPlugin[]): PluginSequenceItem[] {
	const custom = plugins.filter((plugin) => plugin.isCustom);
	const sorted = (placement: PluginPlacement) => custom
		.filter((plugin) => plugin.placement === placement)
		.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
		.map((plugin): PluginSequenceItem => ({ id: plugin.name, kind: 'plugin', plugin }));
	return [...sorted('pre_builtin'), { id: '__builtin__', kind: 'builtin' }, ...sorted('post_builtin')];
}

export function movePluginSequence(items: PluginSequenceItem[], id: string, direction: -1 | 1): PluginSequenceItem[] {
	const index = items.findIndex((item) => item.id === id);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= items.length || items[index]?.kind !== 'plugin') return items;
	const next = [...items];
	const [item] = next.splice(index, 1);
	next.splice(target, 0, item);
	return next;
}

export function buildPluginSequenceUpdates(items: PluginSequenceItem[]): PluginSequenceUpdate[] {
	const builtinIndex = items.findIndex((item) => item.kind === 'builtin');
	if (builtinIndex < 0) throw new Error('builtin-marker-missing');
	const counters: Record<PluginPlacement, number> = { pre_builtin: 0, post_builtin: 0 };
	const updates: PluginSequenceUpdate[] = [];
	items.forEach((item, index) => {
		if (item.kind !== 'plugin') return;
		const placement: PluginPlacement = index < builtinIndex ? 'pre_builtin' : 'post_builtin';
		const order = counters[placement]++;
		if (item.plugin.placement === placement && item.plugin.order === order) return;
		updates.push({
			name: item.plugin.name,
			payload: {
				enabled: item.plugin.enabled,
				config: item.plugin.config,
				path: item.plugin.path || undefined,
				placement,
				order,
			},
		});
	});
	return updates;
}
