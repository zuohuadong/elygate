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

async function fetchPaged(path: string, key: string, totalKeys: string[]): Promise<unknown> {
	const items: unknown[] = [];
	const seen = new Set<string>();
	let offset = 0;
	let total = Number.POSITIVE_INFINITY;
	for (let page = 0; page < MAX_PAGES; page += 1) {
		const separator = path.includes('?') ? '&' : '?';
		const payload = await requestJson<Record<string, unknown>>(`${path}${separator}limit=${PAGE_SIZE}&offset=${offset}`);
		const rows = Array.isArray(payload[key]) ? payload[key] as unknown[] : [];
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
		if (rows.length === 0 || offset >= total || items.length >= MAX_ITEMS) break;
	}
	return { [key]: items };
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
		if (result.status === 'fulfilled') {
			source[name] = result.value;
			return;
		}
		failed.push(name);
	});
	return { source, failed };
}