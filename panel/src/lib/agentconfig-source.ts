// Loads the five configuration sources an AgentConfig bundle is built from.
//
// Shared by the whole-gateway export page and the per-employee copy action so both
// read the same endpoints, the same paging limits and the same dedupe rules: two
// copies of this walk would drift, and the drift would only show as a bundle that
// silently misses rows.

import { requestJson } from './api';

export interface AgentConfigSources {
	models: unknown;
	mcpClients: unknown;
	skills: unknown;
	prompts: unknown;
	agents: unknown;
}

export type AgentConfigSourceName = keyof AgentConfigSources;

export const AGENT_CONFIG_SOURCE_NAMES: AgentConfigSourceName[] = ['models', 'mcpClients', 'skills', 'prompts', 'agents'];

export interface AgentConfigSourceLoad {
	source: AgentConfigSources;
	// failed lists the sources that could not be read, so a caller can warn that the
	// bundle is incomplete instead of shipping it as if it were whole.
	failed: AgentConfigSourceName[];
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const MAX_ITEMS = 5000;

// assignedVirtualMcpGrantsTools resolves the virtual MCPs assigned to a key and reports
// whether any of them actually offers tools. The key only carries ids, and an assigned
// but disabled or empty virtual MCP grants nothing, so the ids alone cannot answer.
export async function assignedVirtualMcpGrantsTools(ids: string[]): Promise<boolean> {
	for (const id of ids) {
		try {
			const payload = await requestJson<Record<string, unknown>>(`/api/mcp/virtual-mcps/${encodeURIComponent(id)}`);
			const definition = payload.virtual_mcp;
			if (!definition || typeof definition !== 'object' || Array.isArray(definition)) continue;
			const record = definition as Record<string, unknown>;
			if (record.enabled === false) continue;
			const tools = Array.isArray(record.tools) ? record.tools : [];
			const grantsATool = tools.some((tool) => {
				if (!tool || typeof tool !== 'object') return false;
				const spec = tool as Record<string, unknown>;
				const names = Array.isArray(spec.tool_names) ? spec.tool_names : [];
				return names.length > 0;
			});
			if (grantsATool) return true;
		} catch {
			// An unreadable virtual MCP cannot be shown to grant anything.
			continue;
		}
	}
	return false;
}

async function fetchPaged(path: string, key: string, totalKeys: string[]): Promise<unknown> {
	const items: unknown[] = [];
	const seen = new Set<string>();
	let offset = 0;
	let total = Number.POSITIVE_INFINITY;
	let finished = false;
	for (let page = 0; page < MAX_PAGES; page += 1) {
		const separator = path.includes('?') ? '&' : '?';
		const payload = await requestJson<Record<string, unknown>>(`${path}${separator}limit=${PAGE_SIZE}&offset=${offset}`);
		// A 200 without the array is a broken contract, not an empty page. Reading it as
		// empty would report a configured gateway as having nothing to export.
		if (!Array.isArray(payload[key])) throw new Error(`${path} answered without a '${key}' array`);
		const rows = payload[key] as unknown[];
		for (const row of rows) {
			const identity = typeof row === 'object' && row !== null
				? JSON.stringify(Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'tools' && field !== 'resources' && field !== 'prompts')))
				: String(row);
			if (seen.has(identity)) continue;
			seen.add(identity);
			items.push(row);
		}
		for (const totalKey of totalKeys) {
			const candidate = payload[totalKey];
			if (typeof candidate === 'number' && Number.isFinite(candidate)) {
				total = candidate;
				break;
			}
		}
		offset += rows.length;
		if (rows.length === 0 || offset >= total) {
			finished = true;
			break;
		}
		// Silently stopping at the cap would export a subset as if it were everything, and
		// a key whitelisted only for the missing rows would look ungranted.
		if (items.length >= MAX_ITEMS) throw new Error(`${path} has more than ${MAX_ITEMS} rows; refusing to export a truncated set`);
	}
	// Without a usable total a paginated endpoint can run out of pages instead of reaching
	// the end, which would look like a complete answer.
	if (!finished) throw new Error(`${path} did not reach its last page within ${MAX_PAGES} pages; refusing to export a partial set`);
	return { [key]: items };
}

// listShape names the array each endpoint must answer with. A 200 carrying the wrong
// shape is a contract failure, not an empty list: treating it as empty would make the
// caller report "this key grants nothing", which is a different (and wrong) story.
const LIST_SHAPE: Record<AgentConfigSourceName, (payload: unknown) => boolean> = {
	models: (payload) => isJsonRecord(payload) && Array.isArray(payload.models),
	mcpClients: (payload) => isJsonRecord(payload) && Array.isArray(payload.clients),
	skills: (payload) => isJsonRecord(payload) && Array.isArray(payload.skills),
	prompts: (payload) => isJsonRecord(payload) && Array.isArray(payload.prompts),
	agents: (payload) => isJsonRecord(payload) && Array.isArray(payload.agents),
};

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadAgentConfigSources(): Promise<AgentConfigSourceLoad> {
	const requests: Record<AgentConfigSourceName, () => Promise<unknown>> = {
		models: () => requestJson<unknown>('/api/models?unfiltered=true&limit=0'),
		mcpClients: () => fetchPaged('/api/mcp/clients', 'clients', ['total_count', 'total']),
		skills: () => fetchPaged('/api/skills', 'skills', ['total']),
		prompts: () => requestJson<unknown>('/api/prompt-repo/prompts'),
		agents: () => requestJson<unknown>('/api/agents'),
	};
	const results = await Promise.allSettled(AGENT_CONFIG_SOURCE_NAMES.map((name) => requests[name]()));
	const source = {
		models: { models: [] },
		mcpClients: { clients: [] },
		skills: { skills: [] },
		prompts: { prompts: [] },
		agents: { agents: [] },
	} as AgentConfigSources;
	const failed: AgentConfigSourceName[] = [];
	results.forEach((result, index) => {
		const name = AGENT_CONFIG_SOURCE_NAMES[index];
		if (result.status === 'fulfilled' && LIST_SHAPE[name](result.value)) {
			source[name] = result.value;
			return;
		}
		failed.push(name);
	});
	return { source, failed };
}