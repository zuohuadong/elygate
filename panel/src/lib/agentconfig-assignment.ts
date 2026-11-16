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
	// deepLink is empty when the grant does not fit a protocol URL; the caller then
	// ships the .acfg file rather than a truncated-looking link.
	deepLink: string;
	fitsDeepLink: boolean;
	// hasScopedContent counts only the sources a key grants (models, MCP servers,
	// agents). Skills and prompts are global, so they would keep a denial-only bundle
	// non-empty and hide the fact that the key itself reaches nothing.
	hasScopedContent: boolean;
}

function deepLinkBytes(value: string): number {
	return new TextEncoder().encode(value).length;
}

export async function buildScopedAgentConfig(sources: AgentConfigSources, scope: AgentConfigScope, label: string, key?: unknown): Promise<ScopedAgentConfig> {
	const scoped = applyAgentConfigScope(sources, scope, key);
	const result = buildAgentConfigPublic(scoped.source as AgentConfigExportSource);
	result.warnings = [...scoped.warnings, ...result.warnings];
	const bundle = await buildBundle({ label, src: 'elygate', trust: 'shared', pub: result.pub });
	let deepLink = '';
	try {
		const candidate = bundleToDeepLink(bundle);
		// bundleToDeepLink throws above ACB_DEEP_LINK_MAX_BYTES; check again so a link
		// that is only just inside the encoder limit still respects this bound.
		if (deepLinkBytes(candidate) <= ACB_DEEP_LINK_MAX_BYTES) deepLink = candidate;
	} catch {
		deepLink = '';
	}
	return {
		result,
		bundle,
		deepLink,
		fitsDeepLink: deepLink !== '',
		hasScopedContent: result.counts.models + result.counts.mcp + result.counts.agents > 0,
	};
}