// Builds the AgentConfig payload for one assigned virtual key.
//
// The employee flow hands a user a deep link, so the bundle has to be produced
// without the AgentConfig page: read the key's governance limits, narrow the five
// sources to what that key can reach, then encode. Kept separate from the page so
// the scoped and unscoped exports share one encoder path.

import { ACB_DEEP_LINK_MAX_BYTES, buildBundle, bundleToDeepLink, type AcbBundle } from './agentconfig';
import { buildAgentConfigPublic, type AgentConfigExportResult, type AgentConfigExportSource } from './agentconfig-export';
import { applyAgentConfigScope, type AgentConfigScope } from './agentconfig-scope';
import type { AgentConfigSources } from './agentconfig-source';

export interface ScopedAgentConfig {
	result: AgentConfigExportResult;
	bundle: AcbBundle;
	deepLink: string;
	// fitsDeepLink is false when the link exceeds what a protocol URL should carry;
	// the caller then ships the .acfg file instead of pasting a truncated-looking URL.
	fitsDeepLink: boolean;
	// hasScopedContent counts only the sources a key grants (models, MCP servers,
	// agents). Skills and prompts are global, so they would keep a denial-only bundle
	// non-empty and hide the fact that the key itself reaches nothing.
	hasScopedContent: boolean;
}

function deepLinkBytes(value: string): number {
	return new TextEncoder().encode(value).length;
}

export async function buildScopedAgentConfig(sources: AgentConfigSources, scope: AgentConfigScope, label: string): Promise<ScopedAgentConfig> {
	const scoped = applyAgentConfigScope(sources, scope) as AgentConfigExportSource;
	const result = buildAgentConfigPublic(scoped);
	const bundle = await buildBundle({ label, src: 'elygate', trust: 'shared', pub: result.pub });
	const deepLink = bundleToDeepLink(bundle);
	return {
		result,
		bundle,
		deepLink,
		fitsDeepLink: deepLinkBytes(deepLink) <= ACB_DEEP_LINK_MAX_BYTES,
		hasScopedContent: result.counts.models + result.counts.mcp + result.counts.agents > 0,
	};
}