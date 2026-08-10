declare module '@elygate/enterprise-panel' {
	import type { Component } from 'svelte';

	export type EnterprisePublicRoute = 'oauth-consent' | 'mcp-auth' | 'mcp-auth-success' | 'mcp-auth-failed' | 'mcp-oauth-callback' | 'agent-handover' | 'scim-oauth-callback';
	export type EnterpriseResourcePages = Record<string, { list: Component<{ resourceName: string }> }>;
	export type EnterprisePublicPages = Partial<Record<EnterprisePublicRoute, Component<{ route: EnterprisePublicRoute }>>>;
	export const enterprisePanelAvailable: boolean;
	export const enterpriseResourcePages: EnterpriseResourcePages;
	export const enterprisePublicPages: EnterprisePublicPages;
}
