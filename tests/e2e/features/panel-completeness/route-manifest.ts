export type LocatorSpec =
	| { kind: "testId"; value: string }
	| { kind: "heading"; value: string | RegExp }
	| { kind: "text"; value: string | RegExp }
	| { kind: "link"; value: string | RegExp };

export interface PanelRouteContract {
	name: string;
	path: string;
	identity: readonly LocatorSpec[];
	primaryContent: readonly LocatorSpec[];
}

export const PANEL_ROUTE_CONTRACTS = [
	{
		name: "Model Catalog",
		path: "/workspace/model-catalog",
		identity: [{ kind: "heading", value: "Model Catalog" }],
		primaryContent: [{ kind: "testId", value: "model-catalog-tab-overview" }],
	},
	{
		name: "Complexity Router",
		path: "/workspace/complexity-router",
		identity: [{ kind: "heading", value: "Complexity Router" }],
		primaryContent: [{ kind: "testId", value: "complexity-router-boundary-simple-medium-input" }],
	},
	{
		name: "Pricing Overrides",
		path: "/workspace/custom-pricing/overrides",
		identity: [
			{ kind: "heading", value: "Pricing Overrides" },
			{ kind: "heading", value: /Pricing overrides customize cost tracking/i },
		],
		primaryContent: [
			{ kind: "testId", value: "pricing-override-create-btn" },
			{ kind: "testId", value: "pricing-overrides-empty-state" },
		],
	},
	{
		name: "MCP Library",
		path: "/workspace/mcp-registry/library",
		identity: [{ kind: "heading", value: "MCP Server Library" }],
		primaryContent: [
			{ kind: "testId", value: "mcp-library-search-input" },
			{ kind: "testId", value: "mcp-library-empty-state" },
		],
	},
	{
		name: "MCP Sessions",
		path: "/workspace/mcp-sessions",
		identity: [{ kind: "heading", value: "MCP Auth Sessions" }],
		primaryContent: [{ kind: "testId", value: "mcp-sessions-search-input" }],
	},
	{
		name: "OAuth Grants",
		path: "/workspace/oauth-grants",
		identity: [{ kind: "heading", value: "OAuth Grants" }],
		primaryContent: [{ kind: "testId", value: "oauth-grants-search-input" }],
	},
	{
		name: "MCP Settings",
		path: "/workspace/mcp-settings",
		identity: [{ kind: "heading", value: "MCP Settings" }],
		primaryContent: [{ kind: "testId", value: "mcp-settings-view" }],
	},
	{
		name: "Prompt Repository",
		path: "/workspace/prompt-repo",
		identity: [
			{ kind: "heading", value: /Build, test, and version your prompts/i },
			{ kind: "text", value: "No prompt selected" },
		],
		primaryContent: [
			{ kind: "testId", value: "empty-state-read-more" },
			{ kind: "testId", value: "sidebar-search" },
		],
	},
	{
		name: "Skills Repository",
		path: "/workspace/skills-repo",
		identity: [
			{ kind: "heading", value: "Skills Repository" },
			{ kind: "heading", value: /Create, version, and share Agent Skills/i },
		],
		primaryContent: [
			{ kind: "testId", value: "skill-search-input" },
			{ kind: "testId", value: "skills-repo-empty-state" },
		],
	},
	{
		name: "Compatibility",
		path: "/workspace/config/compatibility",
		identity: [{ kind: "heading", value: "Compatibility" }],
		primaryContent: [{ kind: "testId", value: "compat-convert-text-to-chat" }],
	},
	{
		name: "Feature Flags",
		path: "/workspace/config/feature-flags",
		identity: [{ kind: "heading", value: "Feature Flags" }],
		primaryContent: [{ kind: "testId", value: "feature-flags-table" }],
	},
	{
		name: "API Keys",
		path: "/workspace/config/api-keys",
		identity: [
			{ kind: "text", value: /Scope Based API Keys/i },
			{ kind: "link", value: /Configure Security Settings/i },
		],
		primaryContent: [
			{ kind: "text", value: /Authentication is currently disabled for inference API calls/i },
			{ kind: "link", value: /Configure Security Settings/i },
			{ kind: "text", value: /Scope Based API Keys/i },
		],
	},
] as const satisfies readonly PanelRouteContract[];

export const PANEL_VIEWPORTS = [
	{ name: "desktop", width: 1440, height: 900 },
	{ name: "mobile", width: 390, height: 844 },
] as const;
