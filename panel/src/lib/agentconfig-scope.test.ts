import { describe, expect, test } from 'bun:test';
import { applyAgentConfigScope, globalAgentConfigScope, matchEntry, scopeFromVirtualKey, virtualKeyFromResponse, vkScopeProblem } from './agentconfig-scope';
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
			{ config: { name: 'github', connection_type: 'stdio', tools_to_execute: ['*'], stdio_config: { command: 'npx' } } },
			{ config: { name: 'docs', connection_type: 'stdio', tools_to_execute: ['*'], stdio_config: { command: 'npx' } } },
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

// The detail endpoint wraps the key, and it nests the MCP client under mcp_client
// (mcp_client_name is not serialized). Both shapes are what the panel actually sees.
const KEY = {
	virtual_key: {
		id: 'vk-1',
		name: 'alice-key',
		is_active: true,
		allow_all_providers: false,
		provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['gpt-4o'], blacklisted_models: [] }],
		mcp_configs: [{ mcp_client: { name: 'github' }, tools_to_execute: ['*'] }],
		agent_grants: [{ agent_name: 'researcher' }],
	},
};

describe('virtualKeyFromResponse', () => {
	test('unwraps the detail response', () => {
		expect(virtualKeyFromResponse(KEY)).toBe(KEY.virtual_key);
	});
	test('accepts a bare key payload', () => {
		expect(virtualKeyFromResponse({ id: 'vk-2' })).toEqual({ id: 'vk-2' });
	});
	test('accepts a single-entry list payload', () => {
		expect(virtualKeyFromResponse({ virtual_keys: [{ id: 'vk-3' }] })).toEqual({ id: 'vk-3' });
	});
});

describe('matchEntry', () => {
	test('plain entries compare case-insensitively', () => {
		expect(matchEntry('GPT-4o', 'gpt-4o')).toBe(true);
		expect(matchEntry('gpt-4o', 'gpt-4o-mini')).toBe(false);
	});
	test('regex entries are full matches', () => {
		expect(matchEntry('regex:^gpt-4.*$', 'gpt-4o')).toBe(true);
		expect(matchEntry('regex:^gpt-4$', 'gpt-4o')).toBe(false);
	});
	test('an invalid pattern never matches', () => {
		expect(matchEntry('regex:(unclosed', 'anything')).toBe(false);
	});
});

describe('vkScopeProblem', () => {
	test('flags disabled and expired keys', () => {
		expect(vkScopeProblem({ virtual_key: { is_active: false } })).toBe('inactive');
		expect(vkScopeProblem({ expires_at: '2020-01-01T00:00:00Z' }, new Date('2026-01-01T00:00:00Z'))).toBe('expired');
		expect(vkScopeProblem({ expires_at: '2030-01-01T00:00:00Z' }, new Date('2026-01-01T00:00:00Z'))).toBeNull();
		expect(vkScopeProblem({ is_active: true })).toBeNull();
	});

	test('an unparseable expiry is unusable rather than never-expiring', () => {
		expect(vkScopeProblem({ expires_at: 'not-a-date' })).toBe('unreadable');
		expect(vkScopeProblem({ expires_at: 1234 })).toBe('unreadable');
		// The API omits expires_at for a key that never expires, so an empty value is a
		// payload we do not understand rather than a permanent key.
		expect(vkScopeProblem({ expires_at: '' })).toBe('unreadable');
	});

	test('a payload with none of the key fields is unreadable, not grant-less', () => {
		expect(vkScopeProblem({})).toBe('unreadable');
		expect(vkScopeProblem({ error: 'boom' })).toBe('unreadable');
		expect(vkScopeProblem({ virtual_key: null })).toBe('unreadable');
		expect(vkScopeProblem({ virtual_key: { id: 'vk-1' } })).toBeNull();
	});
});

describe('scopeFromVirtualKey', () => {
	test('reads providers, mcp clients and agent grants from the wrapped payload', () => {
		const scope = scopeFromVirtualKey(KEY);
		expect(scope.allowAllProviders).toBe(false);
		expect(scope.providers.openai).toEqual({ grants: [{ allowed: ['gpt-4o'], blocked: [], allowedUnrestricted: false, blockedAll: false, hasCredential: true, keys: [] }] });
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
		expect(scoped.source).toBe(SOURCES);
		expect(scoped.warnings).toEqual([]);
	});

	test('narrows models to the provider allow list and drops unreachable providers', () => {
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(KEY), KEY);
		expect(names(scoped.source.models, 'models')).toEqual(['openai/gpt-4o']);
	});

	test('a provider-prefixed allow entry grants the model, as the model catalog resolves it', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'anthropic', allow_all_keys: true, allowed_models: ['anthropic/claude-opus-4'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['anthropic/claude-opus-4']);
		const bare = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'anthropic', allow_all_keys: true, allowed_models: ['claude-opus-4'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(bare), bare).source.models, 'models')).toEqual(['anthropic/claude-opus-4']);
	});

	test('a prefixed entry for another provider grants nothing here', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['anthropic/claude-opus-4'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual([]);
	});

	test('a pattern with RE2 inline flags is not dropped as uncompilable', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['regex:(?i)^GPT-4O$'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['openai/gpt-4o']);
	});

	test('a wildcard allow list plus a regex blacklist keeps blacklist precedence', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['*'], blacklisted_models: ['regex:^gpt-4.*$'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual([]);
	});

	test('a blacklist entry matches case-insensitively', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['*'], blacklisted_models: ['GPT-4o-MINI'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['openai/gpt-4o']);
	});

	test('a "*" listed beside other entries is not unrestricted', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['*', 'gpt-4o-mini'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['openai/gpt-4o-mini']);
	});

	test('an allow-all key still honours the provider entries it names', () => {
		const key = { virtual_key: { allow_all_providers: true, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['gpt-4o-mini'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'anthropic/claude-opus-4']);
	});

	test('filters MCP clients and agents to the grants and keeps skills and prompts', () => {
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(KEY), KEY);
		expect(names(scoped.source.mcpClients, 'clients')).toEqual(['github']);
		expect(names(scoped.source.agents, 'agents')).toEqual(['researcher']);
		expect(scoped.source.skills).toBe(SOURCES.skills);
		expect(scoped.source.prompts).toBe(SOURCES.prompts);
	});

	test('a client granted only some tools is skipped with a warning', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [], mcp_configs: [{ mcp_client: { name: 'github' }, tools_to_execute: ['read_file'] }, { mcp_client: { name: 'docs' }, tools_to_execute: [] }] } };
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key);
		expect(names(scoped.source.mcpClients, 'clients')).toEqual([]);
		expect(scoped.warnings.map((warning) => warning.code)).toEqual(['mcp-tools-restricted', 'mcp-tools-restricted']);
	});

	test('whitespace around "*" is not the wildcard, exactly as governance stores it', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: [' * '] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual([]);
	});

	test('an uppercase Regex: prefix is a literal entry, not a pattern', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['Regex:^gpt-4.*$'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual([]);
	});

	test('a block-everything row blocks only itself, and the other row still grants', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [
			{ provider: 'openai', allow_all_keys: true, allowed_models: ['*'], blacklisted_models: ['*'] },
			{ provider: 'openai', allow_all_keys: true, allowed_models: ['gpt-4o'], blacklisted_models: ['gpt-4o-mini'] },
		] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['openai/gpt-4o']);
	});

	test('a row whose own key withholds the model grants nothing, even if another row allows it', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [
			{ provider: 'openai', allow_all_keys: false, allowed_models: ['gpt-4o'], keys: [{ id: 1, models: ['gpt-4o-mini'] }] },
			{ provider: 'openai', allow_all_keys: false, allowed_models: ['gpt-4o-mini'], keys: [{ id: 2, models: ['gpt-4o'] }] },
		] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual([]);
	});

	test('a vLLM key pinned to one served model exports only that model', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [
			{ provider: 'anthropic', allow_all_keys: false, allowed_models: ['*'], keys: [{ id: 1, models: ['*'], vllm_key_config: { model_name: 'claude-opus-4' } }] },
		] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['anthropic/claude-opus-4']);
	});

	test('whitespace around "*" in the tool grant is not a whole-client grant', () => {
		const key = { virtual_key: { mcp_configs: [{ mcp_client: { name: 'github' }, tools_to_execute: [' * '] }] } };
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key);
		expect(names(scoped.source.mcpClients, 'clients')).toEqual([]);
		expect(scoped.warnings.map((warning) => warning.code)).toEqual(['mcp-tools-restricted']);
	});

	test('agents granted to every caller by default are kept', () => {
		const sources = { ...SOURCES, agents: { agents: [{ name: 'public-agent', allow_by_default: true }, { name: 'private-agent', allow_by_default: false }] } };
		const key = { virtual_key: { agent_grants: [] } };
		expect(names(applyAgentConfigScope(sources, scopeFromVirtualKey(key), key).source.agents, 'agents')).toEqual(['public-agent']);
	});

	test('a key that also reaches MCP through virtual MCPs says so', () => {
		const key = { virtual_key: { mcp_configs: [{ mcp_client: { name: 'github' }, tools_to_execute: ['*'] }] }, virtual_mcp_ids: ['vmcp-1'] };
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key);
		expect(scoped.warnings.map((warning) => warning.code)).toEqual(['mcp-grants-elsewhere']);
	});

	test('numeric virtual MCP ids, as the endpoint serializes them, also count', () => {
		const key = { virtual_key: { mcp_configs: [] }, virtual_mcp_ids: [12] };
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key);
		expect(scoped.warnings.map((warning) => warning.code)).toEqual(['mcp-grants-elsewhere']);
	});

	test('a client governance opens to every caller is kept, unless the key names it', () => {
		const sources = {
			...SOURCES,
			mcpClients: {
				clients: [
					{ config: { name: 'public-client', allow_by_default: true, tools_to_execute: ['*'] } },
					{ config: { name: 'private-client', allow_by_default: false, tools_to_execute: ['*'] } },
					{ config: { name: 'named-restricted', allow_by_default: true, tools_to_execute: ['*'] } },
				],
			},
		};
		const key = { virtual_key: { mcp_configs: [{ mcp_client: { name: 'named-restricted' }, tools_to_execute: ['read_file'] }] } };
		const scoped = applyAgentConfigScope(sources, scopeFromVirtualKey(key), key);
		// A client the key names stays closed even though it is allowed by default.
		expect(names(scoped.source.mcpClients, 'clients')).toEqual(['public-client']);
	});

	test('a client that withholds tools is not exported, and disabled clients are flagged', () => {
		const sources = {
			...SOURCES,
			mcpClients: {
				clients: [
					{ config: { name: 'narrowed', tools_to_execute: ['read_file'], allow_by_default: true } },
					{ config: { name: 'off', disabled: true, allow_by_default: true, tools_to_execute: ['*'] } },
					{ config: { name: 'open', allow_by_default: true, tools_to_execute: ['*'] } },
				],
			},
		};
		const scoped = applyAgentConfigScope(sources, scopeFromVirtualKey({ virtual_key: {} }), { virtual_key: {} });
		expect(names(scoped.source.mcpClients, 'clients')).toEqual(['open']);
		expect(scoped.warnings.map((warning) => `${warning.code}:${warning.name}`)).toEqual(['mcp-tools-restricted:narrowed', 'mcp-disabled:off']);
	});

	test('a provider that binds no credential grants no models', () => {
		const unbound = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: false, keys: [], allowed_models: ['*'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(unbound), unbound).source.models, 'models')).toEqual([]);
		const bound = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: false, keys: [{ id: 1, name: 'k1', models: ['*'] }], allowed_models: ['*'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(bound), bound).source.models, 'models')).toEqual(['openai/gpt-4o', 'openai/gpt-4o-mini']);
		// A bound key with no model list denies every model (deny-by-default in the key table).
		const emptyKey = { virtual_key: { allow_all_providers: false, provider_configs: [{ provider: 'openai', allow_all_keys: false, keys: [{ id: 1, name: 'k1' }], allowed_models: ['*'] }] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(emptyKey), emptyKey).source.models, 'models')).toEqual([]);
	});

	test('a bound key that withholds models narrows the provider to what it serves', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{
			provider: 'openai',
			allow_all_keys: false,
			allowed_models: ['*'],
			keys: [{ id: 1, models: ['gpt-4o'], enabled: true }],
		}] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual(['openai/gpt-4o']);
	});

	test('a disabled key serves nothing', () => {
		const key = { virtual_key: { allow_all_providers: false, provider_configs: [{
			provider: 'openai',
			allow_all_keys: false,
			allowed_models: ['*'],
			keys: [{ id: 1, models: ['*'], enabled: false }],
		}] } };
		expect(names(applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key).source.models, 'models')).toEqual([]);
	});

	test('a key with no grants exports nothing reachable', () => {
		const key = { virtual_key: {} };
		const scoped = applyAgentConfigScope(SOURCES, scopeFromVirtualKey(key), key);
		expect(names(scoped.source.models, 'models')).toEqual([]);
		expect(names(scoped.source.mcpClients, 'clients')).toEqual([]);
		expect(names(scoped.source.agents, 'agents')).toEqual([]);
	});
});

describe('buildScopedAgentConfig', () => {
	test('produces a deep link that carries only the granted entries', async () => {
		const scoped = await buildScopedAgentConfig(SOURCES, scopeFromVirtualKey(KEY), 'Alice · alice-key', KEY);
		expect(scoped.hasScopedContent).toBe(true);
		expect(scoped.fitsDeepLink).toBe(true);
		expect(scoped.deepLink.startsWith('agentconfig://import?')).toBe(true);
		expect(scoped.result.counts).toEqual({ models: 1, mcp: 1, skills: 1, prompts: 1, agents: 1 });
		expect(scoped.bundle.pub.models.map((model) => model.id)).toEqual(['gpt-4o']);
		expect(scoped.bundle.label).toBe('Alice · alice-key');
		expect(scoped.bundle.trust).toBe('shared');
	});

	test('reports no granted access even though global skills and prompts remain', async () => {
		const scoped = await buildScopedAgentConfig(SOURCES, scopeFromVirtualKey({}), 'empty', {});
		expect(scoped.hasScopedContent).toBe(false);
		expect(scoped.result.counts).toEqual({ models: 0, mcp: 0, skills: 1, prompts: 1, agents: 0 });
	});

	test('falls back to the file when the grant cannot fit a deep link', async () => {
		const many = {
			...SOURCES,
			agents: { agents: Array.from({ length: 400 }, (_, index) => ({ name: `agent-${index}-${'x'.repeat(40)}` })) },
		};
		const key = { virtual_key: { agent_grants: many.agents.agents.map((agent) => ({ agent_name: agent.name })) } };
		const scoped = await buildScopedAgentConfig(many, scopeFromVirtualKey(key), 'big', key);
		expect(scoped.fitsDeepLink).toBe(false);
		expect(scoped.deepLink).toBe('');
		expect(scoped.result.counts.agents).toBe(400);
	});

	test('surfaces the scoping warnings on the result', async () => {
		const key = { virtual_key: { mcp_configs: [{ mcp_client: { name: 'github' }, tools_to_execute: ['read_file'] }] } };
		const scoped = await buildScopedAgentConfig(SOURCES, scopeFromVirtualKey(key), 'partial', key);
		expect(scoped.result.warnings.map((warning) => warning.code)).toContain('mcp-tools-restricted');
	});
});