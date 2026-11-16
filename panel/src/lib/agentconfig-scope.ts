// Per-assignment AgentConfig scoping.
//
// The AgentConfig page exports the whole gateway's public configuration. An
// employee assigned a dedicated virtual key should get a bundle that matches what
// that key is allowed to use, so the import does not advertise models, MCP servers
// or agents the key cannot reach. The virtual key is the only source of truth for
// those limits, so this module turns one key's governance payload into a filter and
// applies it to the five export sources.

import { isJsonRecord, type JsonRecord } from './api';

export interface AgentConfigProviderScope {
	// Models this provider grants. '*' grants every model the provider serves.
	allowed: string[];
	blocked: string[];
}

export interface AgentConfigScope {
	// allowAllProviders comes from the key's own flag: when true the key names no
	// provider list and every configured provider is reachable.
	allowAllProviders: boolean;
	providers: Record<string, AgentConfigProviderScope>;
	// restrictMcp/restrictAgents say whether the key's lists are a restriction at
	// all. A key with no MCP entry cannot reach any MCP server (deny-by-default), so
	// an absent list still restricts; the same is true for agents. The flags keep
	// that distinct from "this build has no such scoping".
	restrictMcp: boolean;
	mcpClientNames: string[];
	restrictAgents: boolean;
	agentNames: string[];
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

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value) ? value.filter(isJsonRecord) : [];
}

// scopeFromVirtualKey reads one virtual key (as the governance API returns it) into
// a scope. Unknown or missing fields fall back to deny-by-default, matching how
// governance itself treats an empty provider list or an empty MCP list.
export function scopeFromVirtualKey(key: unknown): AgentConfigScope {
	const record = isJsonRecord(key) ? key : {};
	const allowAllProviders = record.allow_all_providers === true;
	const providers: Record<string, AgentConfigProviderScope> = {};
	for (const config of recordArray(record.provider_configs)) {
		const provider = typeof config.provider === 'string' ? config.provider.trim() : '';
		if (!provider) continue;
		const previous = providers[provider];
		const allowed = stringList(config.allowed_models);
		const blocked = stringList(config.blacklisted_models);
		providers[provider] = previous
			? { allowed: mergeUnique(previous.allowed, allowed), blocked: mergeUnique(previous.blocked, blocked) }
			: { allowed, blocked };
	}
	// An allow-all key can still name provider configs, in which case those entries
	// carry model or key restrictions for the providers they mention. Providers the
	// key does not name stay fully allowed.
	const mcpClientNames = recordArray(record.mcp_configs)
		.map((config) => (typeof config.mcp_client_name === 'string' ? config.mcp_client_name.trim() : ''))
		.filter(Boolean);
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

function modelAllowed(scope: AgentConfigScope, provider: string, id: string): boolean {
	if (scope.allowAllProviders && !(provider in scope.providers)) return true;
	const rule = scope.providers[provider];
	if (!rule) return false;
	const blocked = (value: string) => rule.blocked.includes('*') || rule.blocked.includes(value) || rule.blocked.includes(`${provider}/${value}`);
	if (blocked(id)) return false;
	const allowed = (value: string) => rule.allowed.includes('*') || rule.allowed.includes(value) || rule.allowed.includes(`${provider}/${value}`);
	return allowed(id);
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

function filterMcp(payload: unknown, scope: AgentConfigScope): unknown {
	if (!scope.restrictMcp) return payload;
	if (!isJsonRecord(payload) || !Array.isArray(payload.clients)) return payload;
	const allowed = new Set(scope.mcpClientNames);
	const clients = payload.clients.filter((client) => {
		if (!isJsonRecord(client)) return false;
		const config = isJsonRecord(client.config) ? client.config : client;
		const name = typeof config.name === 'string' ? config.name.trim() : '';
		return Boolean(name) && allowed.has(name);
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
export function applyAgentConfigScope(
	source: { models: unknown; mcpClients: unknown; skills: unknown; prompts: unknown; agents: unknown },
	scope: AgentConfigScope,
): { models: unknown; mcpClients: unknown; skills: unknown; prompts: unknown; agents: unknown } {
	if (isGlobalScope(scope)) return source;
	return {
		models: filterModels(source.models, scope),
		mcpClients: filterMcp(source.mcpClients, scope),
		skills: source.skills,
		prompts: source.prompts,
		agents: filterAgents(source.agents, scope),
	};
}