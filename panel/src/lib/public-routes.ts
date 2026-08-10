export type McpPublicRoute = 'mcp-auth' | 'mcp-auth-success' | 'mcp-auth-failed' | 'mcp-oauth-callback';
export type PublicPanelRoute = 'oauth-consent' | McpPublicRoute | 'agent-handover' | 'scim-oauth-callback';

const publicRoutes: Record<string, PublicPanelRoute> = {
	'/oauth/consent': 'oauth-consent',
	'/workspace/mcp-sessions/auth': 'mcp-auth',
	'/workspace/mcp-sessions/auth-success': 'mcp-auth-success',
	'/workspace/mcp-sessions/auth-failed': 'mcp-auth-failed',
	'/workspace/mcp-registry/oauth-callback': 'mcp-oauth-callback',
	'/agent/handover': 'agent-handover',
	'/workspace/scim/oauth-discover-callback': 'scim-oauth-callback',
};

export function resolvePublicPanelRoute(pathname: string): PublicPanelRoute | null {
	const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
	return publicRoutes[normalized] ?? null;
}
