// Per-assignment AgentConfig scoping.
//
// The AgentConfig page exports the whole gateway's public configuration. An
// employee assigned a dedicated virtual key should get a bundle that matches what
// that key is allowed to use, so the import does not advertise models, MCP servers
// or agents the key cannot reach. The virtual key is the only source of truth for
// those limits, so this module turns one key's governance payload into a filter and
// applies it to the five export sources.
//
// The allow/deny semantics mirror the gateway's own (`core/schemas/account.go` and
// `framework/grant`): a list is unrestricted only when it is exactly ["*"], plain
// entries compare case-insensitively, `regex:` entries are full-match patterns, and a
// blacklist always wins over an allowlist. Getting this looser than the gateway would
// hand out a bundle advertising models the key is refused.

import { isJsonRecord, type JsonRecord } from './api';
import type { AgentConfigExportSource, AgentConfigExportWarning } from './agentconfig-export';

export interface AgentConfigProviderScope {
	allowed: string[];
	blocked: string[];
	// A key can list the same provider more than once. Governance denies if any row's
	// blacklist blocks and allows if any row's allowlist allows, so the flags keep
	// per-row ["*"] meaning after the rows are merged: concatenating them would turn a
	// block-everything row into a literal "*" entry that matches nothing.
	allowedUnrestricted: boolean;
	blockedAll: boolean;
}

export interface AgentConfigScope {
	// allowAllProviders comes from the key's own flag: when true the key reaches every
	// provider it lists no provider config for.
	allowAllProviders: boolean;
	providers: Record<string, AgentConfigProviderScope>;
	// restrictMcp/restrictAgents say whether the key's lists are a restriction at all.
	// A key reaches only the MCP servers and agents it names, so an absent list denies
	// everything; the flags keep that distinct from "this build has no such scoping".
	restrictMcp: boolean;
	mcpClientNames: string[];
	restrictAgents: boolean;
	agentNames: string[];
}

export interface ScopedAgentConfigSource {
	source: AgentConfigExportSource;
	warnings: AgentConfigExportWarning[];
}

// globalAgentConfigScope is the unscoped view used by the whole-gateway export.
export function globalAgentConfigScope(): AgentConfigScope {
	return {
		allowAllProviders: true,
		providers: {},
		restrictMcp: false,
		mcpClientNames: [],
		restrictAgents: false,
		agentNames: [],
	};
}

// stringList keeps entries verbatim. Governance compares the stored strings as they
// are, so trimming or dropping whitespace-only entries here would widen a rule: " * "
// is not ["*"] to the gateway.
function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value) ? value.filter(isJsonRecord) : [];
}

// matchEntry mirrors schemas.MatchEntry: case-insensitive exact match for plain
// entries, full RE2-style match for `regex:` entries, and an uncompilable pattern
// never matches (fail-closed).
export function matchEntry(entry: string, value: string): boolean {
	// Only a lowercase `regex:` prefix is a pattern; `Regex:` is a plain literal to
	// the gateway (core/schemas/regexentry.go).
	if (!entry.startsWith('regex:')) {
		return entry.toLowerCase() === value.toLowerCase();
	}
	const pattern = entry.slice('regex:'.length);
	if (pattern === '*' || pattern === '') return false;
	try {
		return new RegExp(`^(?:${pattern})$`, 'i').test(value);
	} catch {
		return false;
	}
}

function isUnrestricted(list: string[]): boolean {
	return list.length === 1 && list[0] === '*';
}

// listAllows/listBlocks mirror WhiteList.IsAllowed and BlackList.IsBlocked for the
// non-wildcard entries; the ["*"] case is carried by the per-row flags above.
function listAllows(list: string[], value: string): boolean {
	return list.some((entry) => matchEntry(entry, value));
}

function listBlocks(list: string[], value: string): boolean {
	return list.some((entry) => matchEntry(entry, value));
}

// virtualKeyFromResponse unwraps the detail endpoint, which answers
// `{ virtual_key: {...}, virtual_mcp_ids: [...] }`, while create/list payloads are the
// key itself.
export function virtualKeyFromResponse(payload: unknown): JsonRecord {
	if (!isJsonRecord(payload)) return {};
	if (isJsonRecord(payload.virtual_key)) return payload.virtual_key;
	const list = Array.isArray(payload.virtual_keys) ? payload.virtual_keys.filter(isJsonRecord) : [];
	return list.length === 1 ? list[0] : payload;
}

// mcpClientName reads the client name from either payload shape: the detail response
// nests the client (`mcp_client.name`) because `mcp_client_name` is not serialized,
// while config-file payloads carry the flat field.
function mcpClientName(config: JsonRecord): string {
	if (typeof config.mcp_client_name === 'string') return config.mcp_client_name.trim();
	const client = isJsonRecord(config.mcp_client) ? config.mcp_client : {};
	return typeof client.name === 'string' ? client.name.trim() : '';
}

// scopeFromVirtualKey reads one virtual key into a scope. Unknown or missing fields
// fall back to deny-by-default, matching how governance treats an empty provider list
// or an empty MCP list.
export function scopeFromVirtualKey(key: unknown): AgentConfigScope {
	const record = virtualKeyFromResponse(key);
	const allowAllProviders = record.allow_all_providers === true;
	const providers: Record<string, AgentConfigProviderScope> = {};
	for (const config of recordArray(record.provider_configs)) {
		const provider = typeof config.provider === 'string' ? config.provider.trim() : '';
		if (!provider) continue;
		const previous = providers[provider];
		const allowed = stringList(config.allowed_models);
		const blocked = stringList(config.blacklisted_models);
		providers[provider] = previous
			? {
				allowed: mergeUnique(previous.allowed, allowed),
				blocked: mergeUnique(previous.blocked, blocked),
				allowedUnrestricted: previous.allowedUnrestricted || isUnrestricted(allowed),
				blockedAll: previous.blockedAll || isUnrestricted(blocked),
			}
			: { allowed, blocked, allowedUnrestricted: isUnrestricted(allowed), blockedAll: isUnrestricted(blocked) };
	}
	const mcpClientNames = recordArray(record.mcp_configs).map(mcpClientName).filter(Boolean);
	const agentNames = recordArray(record.agent_grants)
		.map((grant) => (typeof grant.agent_name === 'string' ? grant.agent_name.trim() : ''))
		.filter(Boolean);
	return {
		allowAllProviders,
		providers,
		restrictMcp: true,
		mcpClientNames,
		restrictAgents: true,
		agentNames,
	};
}

// mcpGrantIsWholeClient reports whether the key grants every tool of the client. ACB
// has no per-tool field, so a client granted only some of its tools cannot be exported
// without overstating access; those clients are dropped with a warning instead.
export function mcpWholeClientGrants(key: unknown): { whole: Set<string>; partial: Set<string> } {
	const whole = new Set<string>();
	const partial = new Set<string>();
	for (const config of recordArray(virtualKeyFromResponse(key).mcp_configs)) {
		const name = mcpClientName(config);
		if (!name) continue;
		if (isUnrestricted(stringList(config.tools_to_execute))) {
			whole.add(name);
			continue;
		}
		partial.add(name);
	}
	return { whole, partial };
}

// vkScopeProblem reports why a key cannot be handed out at all. The API serializes
// expires_at from a time.Time, so a value the panel cannot parse means the payload is
// not the shape expected; treat that as unusable rather than as "never expires".
export function vkScopeProblem(key: unknown, now: Date = new Date()): 'inactive' | 'expired' | 'unreadable' | null {
	const record = virtualKeyFromResponse(key);
	if (record.is_active === false) return 'inactive';
	if (record.expires_at === undefined || record.expires_at === null || record.expires_at === '') return null;
	if (typeof record.expires_at !== 'string') return 'unreadable';
	const expiry = new Date(record.expires_at);
	if (Number.isNaN(expiry.getTime())) return 'unreadable';
	return expiry.getTime() <= now.getTime() ? 'expired' : null;
}

function mergeUnique(left: string[], right: string[]): string[] {
	const merged = [...left];
	for (const item of right) {
		if (!merged.includes(item)) merged.push(item);
	}
	return merged;
}

function modelIdentifier(model: JsonRecord): { provider: string; id: string } {
	const provider = typeof model.provider === 'string' ? model.provider.trim() : '';
	const name = typeof model.name === 'string' ? model.name.trim() : '';
	const prefix = `${provider}/`;
	return { provider, id: name.startsWith(prefix) ? name.slice(prefix.length) : name };
}

// modelAllowed mirrors grant.permitAllowsModel: a provider the key configures is held
// to that config's blacklist and allowlist even under allow-all; a provider it does not
// configure is opened up only by allow-all.
function modelAllowed(scope: AgentConfigScope, provider: string, id: string): boolean {
	const rule = scope.providers[provider];
	if (!rule) return scope.allowAllProviders;
	if (rule.blockedAll || listBlocks(rule.blocked, id)) return false;
	return rule.allowedUnrestricted || listAllows(rule.allowed, id);
}

function filterModels(payload: unknown, scope: AgentConfigScope): unknown {
	if (!isJsonRecord(payload) || !Array.isArray(payload.models)) return payload;
	const models = payload.models.filter((model) => {
		if (!isJsonRecord(model)) return false;
		const { provider, id } = modelIdentifier(model);
		return Boolean(provider) && Boolean(id) && modelAllowed(scope, provider, id);
	});
	return { ...payload, models };
}

function filterMcp(payload: unknown, scope: AgentConfigScope, whole: Set<string>): unknown {
	if (!scope.restrictMcp) return payload;
	if (!isJsonRecord(payload) || !Array.isArray(payload.clients)) return payload;
	const clients = payload.clients.filter((client) => {
		if (!isJsonRecord(client)) return false;
		const config = isJsonRecord(client.config) ? client.config : client;
		const name = typeof config.name === 'string' ? config.name.trim() : '';
		return Boolean(name) && whole.has(name);
	});
	return { ...payload, clients };
}

function filterAgents(payload: unknown, scope: AgentConfigScope): unknown {
	if (!scope.restrictAgents) return payload;
	if (!isJsonRecord(payload) || !Array.isArray(payload.agents)) return payload;
	const allowed = new Set(scope.agentNames);
	const agents = payload.agents.filter((agent) => {
		if (!isJsonRecord(agent)) return false;
		const name = typeof agent.name === 'string' ? agent.name.trim() : '';
		return Boolean(name) && allowed.has(name);
	});
	return { ...payload, agents };
}

// isGlobalScope reports a scope that restricts nothing, so a caller can skip the
// filtering walk (and keep the source objects identical) for the whole-gateway export.
export function isGlobalScope(scope: AgentConfigScope): boolean {
	return scope.allowAllProviders && Object.keys(scope.providers).length === 0 && !scope.restrictMcp && !scope.restrictAgents;
}

// applyAgentConfigScope narrows the five export sources to what the key may use.
// Skills and prompts are not scoped per key today, so they pass through unchanged.
// `key` is only consulted for MCP tool-level grants, which the sources alone cannot
// express.
export function applyAgentConfigScope(source: AgentConfigExportSource, scope: AgentConfigScope, key?: unknown): ScopedAgentConfigSource {
	if (isGlobalScope(scope)) return { source, warnings: [] };
	const warnings: AgentConfigExportWarning[] = [];
	const { whole, partial } = mcpWholeClientGrants(key ?? {});
	// A client the key reaches through a project or access profile rather than its own
	// mcp_configs is not in `whole`, so it must not be exported. Report the ones the key
	// names with a tool subset so an operator knows why they are missing.
	for (const name of partial) {
		if (!whole.has(name)) warnings.push({ code: 'mcp-tools-restricted', name });
	}
	return {
		source: {
			models: filterModels(source.models, scope),
			mcpClients: filterMcp(source.mcpClients, scope, whole),
			skills: source.skills,
			prompts: source.prompts,
			agents: filterAgents(source.agents, scope),
		},
		warnings,
	};
}