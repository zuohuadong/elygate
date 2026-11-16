import { afterEach, describe, expect, test } from 'bun:test';
import { assignedVirtualMcpGrants, loadAgentConfigSources } from './agentconfig-source';

const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

// The loader pages /api/mcp/clients and /api/skills, so the mock answers by path and
// returns the whole set on the first page.
function mockSources(overrides: Record<string, () => Response>): void {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		for (const [path, respond] of Object.entries(overrides)) {
			if (url.includes(path)) return respond();
		}
		return jsonResponse({});
	}) as typeof fetch;
}

const HEALTHY: Record<string, () => Response> = {
	'/api/models': () => jsonResponse({ models: [{ provider: 'openai', name: 'openai/gpt-4o' }] }),
	'/api/mcp/clients': () => jsonResponse({ clients: [{ config: { name: 'github' } }], total_count: 1 }),
	'/api/skills': () => jsonResponse({ skills: [{ id: 'docs', name: 'docs' }], total: 1 }),
	'/api/prompt-repo/prompts': () => jsonResponse({ prompts: [{ id: 'p1', name: 'Review' }] }),
	'/api/agents': () => jsonResponse({ agents: [{ name: 'researcher', enabled: true }] }),
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('loadAgentConfigSources', () => {
	test('loads every source and reports none failed', async () => {
		mockSources(HEALTHY);
		const loaded = await loadAgentConfigSources();
		expect(loaded.failed).toEqual([]);
		expect((loaded.source.models as { models: unknown[] }).models).toHaveLength(1);
		expect((loaded.source.mcpClients as { clients: unknown[] }).clients).toHaveLength(1);
	});

	test('a 200 with the wrong shape is a failed source, not an empty one', async () => {
		mockSources({
			...HEALTHY,
			'/api/models': () => jsonResponse({}),
			'/api/mcp/clients': () => jsonResponse({ clients: 'nope' }),
			'/api/agents': () => jsonResponse({ error: 'boom' }),
		});
		const loaded = await loadAgentConfigSources();
		expect(loaded.failed.sort()).toEqual(['agents', 'mcpClients', 'models']);
		// The sources that did answer still load, so a partial bundle remains possible.
		expect((loaded.source.skills as { skills: unknown[] }).skills).toHaveLength(1);
	});

	test('a paginated endpoint that never reaches its last page fails instead of truncating', async () => {
		let call = 0;
		globalThis.fetch = (async () => {
			call += 1;
			// No total anywhere: only the page cap can stop this.
			return jsonResponse({ clients: Array.from({ length: 100 }, (_, index) => ({ config: { name: `client-${call}-${index}` } })) });
		}) as unknown as typeof fetch;
		const loaded = await loadAgentConfigSources();
		expect(loaded.failed).toContain('mcpClients');
	});

	test('a non-200 response is a failed source', async () => {
		mockSources({ ...HEALTHY, '/api/skills': () => jsonResponse({ error: 'unavailable' }, 503) });
		const loaded = await loadAgentConfigSources();
		expect(loaded.failed).toEqual(['skills']);
	});
});

describe('assignedVirtualMcpGrants', () => {
	test('an enabled virtual MCP with tool names grants something', async () => {
		mockSources({
			'/api/mcp/virtual-mcps/12': () => jsonResponse({ virtual_mcp: { id: 12, enabled: true, tools: [{ tool_names: ['github-read'] }] } }),
		});
		expect(await assignedVirtualMcpGrants(['12'])).toBe('grants');
	});

	test('a disabled or tool-less virtual MCP grants nothing', async () => {
		mockSources({
			'/api/mcp/virtual-mcps/12': () => jsonResponse({ virtual_mcp: { id: 12, enabled: false, tools: [{ tool_names: ['github-read'] }] } }),
			'/api/mcp/virtual-mcps/13': () => jsonResponse({ virtual_mcp: { id: 13, enabled: true, tools: [{ tool_names: [] }] } }),
		});
		expect(await assignedVirtualMcpGrants(['12', '13'])).toBe('none');
	});

	test('an unreadable virtual MCP is reported as unreadable, not as no grant', async () => {
		mockSources({ '/api/mcp/virtual-mcps/99': () => jsonResponse({ error: 'not found' }, 404) });
		expect(await assignedVirtualMcpGrants(['99'])).toBe('unreadable');
	});
});
