import { describe, expect, test } from 'bun:test';
import { buildAgentConfigPublic, type AgentConfigExportSource } from './agentconfig-export';

const SOURCE: AgentConfigExportSource = {
	models: {
		models: [
			{ provider: 'openai', name: 'openai/gpt-4o' },
			{ provider: 'openai', name: 'openai/gpt-4o' },
			{ provider: 'anthropic', name: 'claude-sonnet-4', alias: 'sonnet' },
			{ provider: '', name: 'broken' },
		],
	},
	mcpClients: {
		clients: [
			{
				config: {
					name: 'github',
					connection_type: 'stdio',
					disabled: false,
					stdio_config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envs: ['GITHUB_TOKEN=ghp_super_secret', 'PLAIN_NAME'] },
				},
				tools: [{ name: 'create_issue' }],
			},
			{ config: { name: 'remote-docs', connection_type: 'http', connection_string: 'https://private.example.com/mcp?token=secret' } },
			{ config: { name: 'in-process', connection_type: 'inprocess' } },
		],
	},
	skills: { skills: [{ id: 'skill-1', name: 'Docs' }, { id: '' }] },
	prompts: { prompts: [{ id: 'prompt-1', name: 'Review' }, { id: 'prompt-2', name: 'x'.repeat(90) }] },
	agents: { agents: [{ name: 'researcher', display_name: 'Researcher', model: 'openai/gpt-4o', skill_ids: ['skill-1'] }, { name: 'x'.repeat(70) }] },
};

describe('AgentConfig export mapping', () => {
	test('maps Elygate resources to the ACB public section', () => {
		const result = buildAgentConfigPublic(SOURCE);
		expect(result.counts).toEqual({ models: 2, mcp: 2, skills: 1, prompts: 2, agents: 1 });
		expect(result.capabilities).toEqual(['mcp', 'models', 'skills', 'prompts', 'agents']);
		expect(result.pub.models).toEqual([
			{ provider: 'openai', id: 'gpt-4o' },
			{ provider: 'anthropic', id: 'claude-sonnet-4', alias: 'sonnet' },
		]);
		expect(result.pub.mcp).toEqual([
			{
				name: 'github',
				enabled: true,
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@modelcontextprotocol/server-github'],
				envKeys: ['GITHUB_TOKEN', 'PLAIN_NAME'],
			},
			{ name: 'remote-docs', enabled: true, transport: 'http', args: [], envKeys: [] },
		]);
		expect(result.pub.skills).toEqual([{ id: 'Docs', enabled: true, order: 1 }]);
		expect(result.pub.prompts[1]).toEqual({ id: 'prompt-2', title: 'x'.repeat(80) });
		expect(result.pub.agents).toEqual([{ id: 'researcher', name: 'Researcher', model: 'openai/gpt-4o', skillIds: ['skill-1'] }]);
	});

	test('never leaks secret values or private endpoints into the public bundle', () => {
		const serialized = JSON.stringify(buildAgentConfigPublic(SOURCE).pub);
		expect(serialized).not.toContain('ghp_super_secret');
		expect(serialized).not.toContain('private.example.com');
		expect(serialized).not.toContain('token=secret');
	});

	test('reports each omission and downgrade to the exporter', () => {
		const codes = buildAgentConfigPublic(SOURCE).warnings.map((warning) => warning.code);
		expect(codes).toContain('model-invalid');
		expect(codes).toContain('mcp-env-values-omitted');
		expect(codes).toContain('mcp-endpoint-not-public');
		expect(codes).toContain('mcp-unsupported-transport');
		expect(codes).toContain('skill-invalid');
		expect(codes).toContain('prompt-title-truncated');
		expect(codes).toContain('agent-invalid');
	});

	test('drops credential-bearing launch arguments and says so', () => {
		const source: AgentConfigExportSource = {
			models: undefined,
			mcpClients: {
				clients: [
					{
						config: {
							name: 'flagged',
							connection_type: 'stdio',
							stdio_config: {
								command: 'server',
								args: ['--verbose', '--api-key', 'sk-live-abcdefgh12345678', '--token=plainvalue', '--path', '/srv/tools'],
							},
						},
					},
					{
						config: {
							name: 'bare',
							connection_type: 'stdio',
							stdio_config: { command: 'server', args: ['--flag', 'ghp_abcdefgh12345678', 'xoxb-1234567890-abcdef'] },
						},
					},
				],
			},
			skills: undefined,
			prompts: undefined,
			agents: undefined,
		};
		const result = buildAgentConfigPublic(source);
		expect(result.pub.mcp[0].args).toEqual(['--verbose', '--path', '/srv/tools']);
		expect(result.pub.mcp[1].args).toEqual(['--flag']);
		expect(result.warnings.filter((warning) => warning.code === 'mcp-args-redacted').map((warning) => warning.name)).toEqual(['flagged', 'bare']);
		const serialized = JSON.stringify(result.pub);
		expect(serialized).not.toContain('sk-live-abcdefgh12345678');
		expect(serialized).not.toContain('plainvalue');
		expect(serialized).not.toContain('ghp_abcdefgh12345678');
		expect(serialized).not.toContain('xoxb-1234567890-abcdef');
	});

	test('redacts wrapped credentials and drops a command that embeds one', () => {
		const source: AgentConfigExportSource = {
			models: undefined,
			mcpClients: {
				clients: [
					{
						config: {
							name: 'headers',
							connection_type: 'stdio',
							stdio_config: { command: 'server', args: ['--header', 'Authorization: Bearer topsecret', '--env=API_KEY=topsecret', '--verbose'] },
						},
					},
					{ config: { name: 'wrapped', connection_type: 'stdio', stdio_config: { command: 'sh -c "server --token topsecret"' } } },
					{ config: { name: 'disabled-agent-holder', connection_type: 'stdio', stdio_config: { command: 'server' } } },
				],
			},
			skills: undefined,
			prompts: undefined,
			agents: { agents: [{ name: 'disabled', enabled: false }, { name: 'enabled', enabled: true }] },
		};
		const result = buildAgentConfigPublic(source);
		expect(result.pub.mcp.map((entry) => entry.name)).toEqual(['headers', 'disabled-agent-holder']);
		expect(result.pub.mcp[0].args).toEqual(['--verbose']);
		expect(result.pub.agents.map((entry) => entry.id)).toEqual(['enabled']);
		const codes = result.warnings.map((warning) => warning.code);
		expect(codes).toContain('mcp-args-redacted');
		expect(codes).toContain('mcp-command-not-public');
		expect(codes).toContain('agent-disabled');
		expect(JSON.stringify(result.pub)).not.toContain('topsecret');
	});

	test('catches inline credential forms in arguments and commands', () => {
		const source: AgentConfigExportSource = {
			models: undefined,
			mcpClients: {
				clients: [
					{
						config: {
							name: 'inline',
							connection_type: 'stdio',
							stdio_config: { command: 'server', args: ['--token=topsecret', '-H', 'X-Api-Key: topsecret', 'OPENAI_API_KEY=topsecret', '--verbose'] },
						},
					},
					{ config: { name: 'cmd-eq', connection_type: 'stdio', stdio_config: { command: 'server --token=topsecret' } } },
					{ config: { name: 'cmd-header', connection_type: 'stdio', stdio_config: { command: 'server --header=Authorization: Bearer topsecret' } } },
					{ config: { name: 'cmd-h', connection_type: 'stdio', stdio_config: { command: 'server -H X-Api-Key: topsecret' } } },
					{ config: { name: 'clean', connection_type: 'stdio', stdio_config: { command: 'cli auth login' } } },
				],
			},
			skills: undefined,
			prompts: undefined,
			agents: undefined,
		};
		const result = buildAgentConfigPublic(source);
		expect(result.pub.mcp.map((entry) => entry.name)).toEqual(['inline', 'clean']);
		expect(result.pub.mcp[0].args).toEqual(['--verbose']);
		expect(JSON.stringify(result.pub)).not.toContain('topsecret');
		// A subcommand that merely shares a word with a credential name is not a secret.
		expect(result.pub.mcp[1].command).toBe('cli auth login');
	});

	test('matches credential names by normalized suffix, not only a fixed list', () => {
		const source: AgentConfigExportSource = {
			models: undefined,
			mcpClients: {
				clients: [
					{
						config: {
							name: 'names',
							connection_type: 'stdio',
							stdio_config: {
								command: 'server',
								args: ['--clientSecret=plainvalue', '--client-secret', 'plainvalue', 'OPENAI_KEY=plainvalue', 'X-Auth-Token: plainvalue', '--sort-key', 'created_at'],
							},
						},
					},
				],
			},
			skills: undefined,
			prompts: undefined,
			agents: undefined,
		};
		const result = buildAgentConfigPublic(source);
		// An ordinary key argument survives; every credential-shaped name does not.
		expect(result.pub.mcp[0].args).toEqual(['--sort-key', 'created_at']);
		expect(JSON.stringify(result.pub)).not.toContain('plainvalue');
	});

	test('produces an empty but valid public section when nothing is configured', () => {
		const result = buildAgentConfigPublic({ models: undefined, mcpClients: undefined, skills: undefined, prompts: undefined, agents: undefined });
		expect(result.counts).toEqual({ models: 0, mcp: 0, skills: 0, prompts: 0, agents: 0 });
		expect(result.pub).toEqual({ mcp: [], models: [], skills: [], prompts: [], agents: [], resources: [] });
	});
});