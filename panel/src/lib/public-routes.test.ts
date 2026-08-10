import { describe, expect, test } from 'bun:test';
import { resolvePublicPanelRoute } from './public-routes';

describe('public panel routes', () => {
	test('keeps external OAuth and MCP flow landing paths outside the hash router', () => {
		expect(resolvePublicPanelRoute('/oauth/consent')).toBe('oauth-consent');
		expect(resolvePublicPanelRoute('/workspace/mcp-sessions/auth/')).toBe('mcp-auth');
		expect(resolvePublicPanelRoute('/workspace/mcp-registry/oauth-callback')).toBe('mcp-oauth-callback');
		expect(resolvePublicPanelRoute('/agent/handover')).toBe('agent-handover');
		expect(resolvePublicPanelRoute('/workspace/scim/oauth-discover-callback')).toBe('scim-oauth-callback');
	});

	test('leaves admin paths to the hash router', () => {
		expect(resolvePublicPanelRoute('/workspace/providers')).toBeNull();
		expect(resolvePublicPanelRoute('/')).toBeNull();
	});
});
