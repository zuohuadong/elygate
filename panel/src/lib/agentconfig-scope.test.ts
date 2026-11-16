import { describe, expect, test } from 'bun:test';
import { applyAgentConfigScope, globalAgentConfigScope, scopeFromVirtualKey } from './agentconfig-scope';
import { buildScopedAgentConfig } from './agentconfig-assignment';

const SOURCES = {
	models: {
		models: [
			{ provider: 'openai', name: 'openai/gpt-4o' },
			{ provider: 'openai', name: 'openai/gpt-4o-mini' },
			{ provider: 'anthropic', name: 'anthropic/claude-sonnet-4' },
			{ provider: 'anthropic', name: 'anthropic/claude-opus-4' },
		],
	},
	mcpClients: {
		clients: [
			{ config: { name: 'github', connection_type: 'stdio', stdio_config: { command: 'npx' } } },
			{ config: { name: 'docs', connection_type: 'stdio', stdio_config: { command: 'npx' } } },
		],
	},
	skills: { skills: [{ id: 'skill-1', name: 'Docs' }] },
	prompts: { prompts: [{ id: 'prompt-1', name: 'Review' }] },
	agents: { agents: [{ name: 'researcher' }, { name: 'writer' }] },
};

function names(payload: unknown, key: string): string[] {
	const record = payload as Record<string, unknown[]>;
	return (record[key] ?? []).map((entry) => {
		const row = entry as { name?: string; config?: { name?: string } };
		return String(row.config?.name ?? row.name ?? '');
	});
}

const KEY = {
	allow_all_providers: false,
	provider_configs: [{ provider: 'openai', allowed_models: ['gpt-4o'], blacklisted_models: [] }],
	mcp_configs: [{ mcp_client_name: 'github' }],
	agent_grants: [{ agent_name: 'researcher' }],
};

describe('scopeFromVirtualKey', () => {
	test('reads providers, mcp clients and agent grants', () => {
		const scope = scopeFromVirtualKey(KEY);
		expect(scope.allowAllProviders).toBe(false);
		expect(scope.providers.openai).toEqual({ allowed: ['gpt-4o'], blocked: [] });
		expect(scope.mcpClientNames).toEqual(['github']);
		expect(scope.agentNames).toEqual(['researcher']);
	});

	test('an empty key denies everything instead of granting everything', () => {
		const scope = scopeFromVirtualKey({});
		expect(scope.allowAllProviders).toBe(false);
		expect(scope.providers).toEqual({});
		expect(scope.mcpClientNames).toEqual([]);
		expect(scope.agentNames).toEqual([]);
	});

	test('a non-object payload is treated as a key with no grants', () => {
		expect(scopeFromVirtualKey(null).mcpClientNames).toEqual([]);
		expect(scopeFromVirtualKey('nope').agentNames).toEqual([]);
	});
});

describe('applyAgentConfigScope', () => {
	test('the global scope leaves every source untouched', () => {
		const scoped = applyAgentConfigScope(SOURCES, globalAgentConfigScope());
		expect(scoped).toBe(SOURCES);
	});

	test('narrows models to the provider allow list and drops unreachable providers', () => {
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(KEY));
		expect(names(scoped.models, 'models')).toEqual(['openai/gpt-4o']);
	});

	test('accepts bare and provider-prefixed allow list entries', () => {
		const scope = scopeFromVirtualKey({ allow_all_providers: false, provider_configs: [{ provider: 'anthropic', allowed_models: ['anthropic/claude-opus-4'] }] });
		expect(names(applyAgentConfigScope(SOURCES, scope).models, 'models')).toEqual(['anthropic/claude-opus-4']);
	});

	test('a wildcard allows every model of the provider and a blacklist still wins', () => {
		const scope = scopeFromVirtualKey({ allow_all_providers: false, provider_configs: [{ provider: 'openai', allowed_models: ['*'], blacklisted_models: ['gpt-4o-mini'] }] });
		expect(names(applyAgentConfigScope(SOURCES, scope).models, 'models')).toEqual(['openai/gpt-4o']);
	});

	test('an allow-all key still honours the provider entries it names', () => {
		const scope = scopeFromVirtualKey({ allow_all_providers: true, provider_configs: [{ provider: 'openai', allowed_models: ['gpt-4o-mini'] }] });
		expect(names(applyAgentConfigScope(SOURCES, scope).models, 'models')).toEqual(['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'anthropic/claude-opus-4']);
	});

	test('filters MCP clients and agents to the grants and keeps skills and prompts', () => {
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(KEY));
		expect(names(scoped.mcpClients, 'clients')).toEqual(['github']);
		expect(names(scoped.agents, 'agents')).toEqual(['researcher']);
		expect(scoped.skills).toBe(SOURCES.skills);
		expect(scoped.prompts).toBe(SOURCES.prompts);
	});

	test('a key with no grants exports nothing reachable', () => {
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey({}));
		expect(names(scoped.models, 'models')).toEqual([]);
		expect(names(scoped.mcpClients, 'clients')).toEqual([]);
		expect(names(scoped.agents, 'agents')).toEqual([]);
	});
});

describe('buildScopedAgentConfig', () => {
	test('produces a deep link that carries only the granted entries', async () => {
		const scoped = await buildScopedAgentConfig(SOURCES, scopeFromVirtualKey(KEY), 'Alice · alice-key');
		expect(scoped.hasScopedContent).toBe(true);
		expect(scoped.fitsDeepLink).toBe(true);
		expect(scoped.deepLink.startsWith('agentconfig://import?')).toBe(true);
		expect(scoped.result.counts).toEqual({ models: 1, mcp: 1, skills: 1, prompts: 1, agents: 1 });
		expect(scoped.bundle.pub.models.map((model) => model.id)).toEqual(['gpt-4o']);
		expect(scoped.bundle.label).toBe('Alice · alice-key');
		expect(scoped.bundle.trust).toBe('shared');
	});

	test('reports no granted access even though global skills and prompts remain', async () => {
		const scoped = await buildScopedAgentConfig(SOURCES, scopeFromVirtualKey({}), 'empty');
		expect(scoped.hasScopedContent).toBe(false);
		expect(scoped.result.counts).toEqual({ models: 0, mcp: 0, skills: 1, prompts: 1, agents: 0 });
	});
});