import { isJsonRecord, type JsonRecord } from './api';
import {
	type AcbAgentEntry,
	type AcbCapability,
	type AcbMcpEntry,
	type AcbModelEntry,
	type AcbPromptEntry,
	type AcbPublic,
	type AcbSkillEntry,
	deriveCapabilities,
	emptyPublic,
} from './agentconfig';

export type AgentConfigExportWarningCode =
	| 'mcp-unsupported-transport'
	| 'mcp-name-too-long'
	| 'mcp-endpoint-not-public'
	| 'mcp-env-values-omitted'
	| 'mcp-args-redacted'
	| 'mcp-command-not-public'
	| 'mcp-tools-restricted'
	| 'model-invalid'
	| 'skill-invalid'
	| 'prompt-invalid'
	| 'prompt-title-truncated'
	| 'agent-invalid'
	| 'agent-disabled';

export interface AgentConfigExportWarning {
	code: AgentConfigExportWarningCode;
	name?: string;
}

export interface AgentConfigExportSource {
	models: unknown;
	mcpClients: unknown;
	skills: unknown;
	prompts: unknown;
	agents: unknown;
}

export interface AgentConfigExportResult {
	pub: AcbPublic;
	capabilities: AcbCapability[];
	warnings: AgentConfigExportWarning[];
	counts: {
		models: number;
		mcp: number;
		skills: number;
		prompts: number;
		agents: number;
	};
}

function arrayFrom(value: unknown, key: string): JsonRecord[] {
	if (Array.isArray(value)) return value.filter(isJsonRecord);
	if (!isJsonRecord(value)) return [];
	const candidate = value[key];
	return Array.isArray(candidate) ? candidate.filter(isJsonRecord) : [];
}

function stringValue(record: JsonRecord, key: string): string {
	const value = record[key];
	return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(record: JsonRecord, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === 'boolean' ? value : undefined;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function validLength(value: string, max: number): boolean {
	return value.length > 0 && value.length <= max;
}

function modelEntries(payload: unknown, warnings: AgentConfigExportWarning[]): AcbModelEntry[] {
	const seen = new Set<string>();
	const entries: AcbModelEntry[] = [];
	for (const model of arrayFrom(payload, 'models')) {
		const provider = stringValue(model, 'provider');
		const name = stringValue(model, 'name');
		const prefix = `${provider}/`;
		const id = name.startsWith(prefix) ? name.slice(prefix.length) : name;
		if (!validLength(provider, 64) || !validLength(id, 128)) {
			warnings.push({ code: 'model-invalid', name: name || provider || undefined });
			continue;
		}
		const key = `${provider}\0${id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const alias = stringValue(model, 'alias');
		const maxTokens = typeof model.maxTokens === 'number' && Number.isInteger(model.maxTokens) && model.maxTokens > 0
			? model.maxTokens
			: undefined;
		entries.push({
			provider,
			id,
			...(validLength(alias, 64) ? { alias } : {}),
			...(maxTokens ? { maxTokens } : {}),
		});
	}
	return entries;
}

// A secret can ride in a command-line argument just as easily as in an environment
// value (`--api-key sk-...`), and args travel in the public payload. A flag that names a
// credential drops itself and its value; a bare value shaped like a known token drops
// alone. Dropping too little leaks, dropping too much only makes the server need its
// args from the user, so the redaction stays shape-based rather than statistical.
const SECRET_WORDS = 'api[-_]?key|apikey|token|secret|password|passwd|pwd|auth|authorization|credential|bearer|access[-_]?key|private[-_]?key';
// A flag that names a credential, or carries a header that may hold one, drops itself
// and (when it has no inline value) the argument after it.
const SECRET_ARG_FLAG = new RegExp(`^(?:--?)?(?:[a-z0-9]+[-_])*(?:${SECRET_WORDS})s?$|^(?:--?)?headers?$`, 'i');
// An argument that is itself a credential: a known token shape, an auth header value,
// or a `NAME=value` pairing whose NAME is a credential word.
const SECRET_ARG_VALUE = new RegExp([
	'^(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{8,}|github_pat_[a-z0-9_]{8,}|xox[abposr]-[a-z0-9-]{8,}|akia[a-z0-9]{12,}|ey[a-z0-9_-]{8,}\\.[a-z0-9_-]{8,}\\.[a-z0-9_-]{8,})$',
	'^(?:authorization|proxy-authorization)\\s*:',
	'^(?:bearer|basic|token|digest|apikey)\\s+\\S{4,}$',
	`(?:^|[\\s,;&=])(?:${SECRET_WORDS})=[^\\s]{1,}`,
].join('|'), 'i');

function carriesSecret(value: string): boolean {
	return SECRET_ARG_VALUE.test(value.trim());
}

// A command line is a single string, so the arguments inside it are inspected
// token by token. Only dash-prefixed tokens are treated as credential flags, so a
// subcommand that merely shares a word ("cli auth login") is not mistaken for one.
function commandCarriesSecret(command: string): boolean {
	return command.split(/\s+/).some((token) => {
		const trimmed = token.replace(/^["']|["']$/g, '');
		if (!trimmed) return false;
		if (trimmed.startsWith('-') && SECRET_ARG_FLAG.test(trimmed)) return true;
		return carriesSecret(trimmed);
	});
}

function redactArgs(args: string[]): { args: string[]; redacted: boolean } {
	const kept: string[] = [];
	let redacted = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const separator = arg.indexOf('=');
		const flag = (separator === -1 ? arg : arg.slice(0, separator)).trim();
		// Only a dash-prefixed flag names a credential; a bare positional word that
		// shares the name ("auth" as a subcommand) must survive.
		if (flag.startsWith('-') && SECRET_ARG_FLAG.test(flag)) {
			redacted = true;
			// A flag without an inline value carries the credential in the next
			// argument, so that one goes too.
			if (separator === -1 && index + 1 < args.length) index += 1;
			continue;
		}
		if (SECRET_ARG_VALUE.test(arg.trim())) {
			redacted = true;
			continue;
		}
		kept.push(arg);
	}
	return { args: kept, redacted };
}

function mcpEntries(payload: unknown, warnings: AgentConfigExportWarning[]): AcbMcpEntry[] {
	const entries: AcbMcpEntry[] = [];
	for (const client of arrayFrom(payload, 'clients')) {
		const config = isJsonRecord(client.config) ? client.config : client;
		const name = stringValue(config, 'name');
		if (!validLength(name, 64)) {
			warnings.push({ code: 'mcp-name-too-long', name: name || undefined });
			continue;
		}
		const connectionType = stringValue(config, 'connection_type').toLowerCase();
		if (connectionType !== 'stdio' && connectionType !== 'sse' && connectionType !== 'http') {
			warnings.push({ code: 'mcp-unsupported-transport', name });
			continue;
		}
		const enabled = booleanValue(config, 'disabled') !== true;
		if (connectionType !== 'stdio') {
			// ACB puts HTTP/SSE endpoints in the encrypted secret section. A public
			// export keeps the entry so a client can ask the user for the URL.
			warnings.push({ code: 'mcp-endpoint-not-public', name });
			entries.push({ name, enabled, transport: connectionType, args: [], envKeys: [] });
			continue;
		}
		const stdio = isJsonRecord(config.stdio_config) ? config.stdio_config : {};
		const command = stringValue(stdio, 'command');
		// A command line can embed arguments too (`sh -c "server --token ..."`), so it
		// gets the same treatment. Without its command the entry cannot start anything,
		// so the client is skipped rather than shipped half-configured.
		if (command && commandCarriesSecret(command)) {
			warnings.push({ code: 'mcp-command-not-public', name });
			continue;
		}
		const rawArgs = stringList(stdio.args);
		const envs = stringList(stdio.envs);
		const envKeys: string[] = [];
		let omittedEnvValue = false;
		for (const entry of envs) {
			const separator = entry.indexOf('=');
			const key = (separator === -1 ? entry : entry.slice(0, separator)).trim();
			if (separator !== -1) omittedEnvValue = true;
			if (validLength(key, 128) && !envKeys.includes(key)) envKeys.push(key);
		}
		if (omittedEnvValue) warnings.push({ code: 'mcp-env-values-omitted', name });
		const { args, redacted } = redactArgs(rawArgs);
		if (redacted) warnings.push({ code: 'mcp-args-redacted', name });
		entries.push({
			name,
			enabled,
			transport: 'stdio',
			...(command ? { command } : {}),
			args,
			envKeys,
			...(stringValue(config, 'description') ? { description: stringValue(config, 'description').slice(0, 200) } : {}),
		});
	}
	return entries;
}

function skillEntries(payload: unknown, warnings: AgentConfigExportWarning[]): AcbSkillEntry[] {
	const entries: AcbSkillEntry[] = [];
	for (const skill of arrayFrom(payload, 'skills')) {
		const id = stringValue(skill, 'name') || stringValue(skill, 'id');
		if (!validLength(id, 64)) {
			warnings.push({ code: 'skill-invalid', name: stringValue(skill, 'name') || undefined });
			continue;
		}
		entries.push({
			id,
			enabled: booleanValue(skill, 'enabled') !== false,
			order: entries.length + 1,
		});
	}
	return entries;
}

function promptEntries(payload: unknown, warnings: AgentConfigExportWarning[]): AcbPromptEntry[] {
	const entries: AcbPromptEntry[] = [];
	for (const prompt of arrayFrom(payload, 'prompts')) {
		const id = stringValue(prompt, 'id');
		if (!validLength(id, 64)) {
			warnings.push({ code: 'prompt-invalid', name: stringValue(prompt, 'name') || undefined });
			continue;
		}
		const name = stringValue(prompt, 'name');
		const title = name.length > 80 ? name.slice(0, 80) : name;
		if (name.length > 80) warnings.push({ code: 'prompt-title-truncated', name: id });
		entries.push({ id, ...(title ? { title } : {}) });
	}
	return entries;
}

function agentEntries(payload: unknown, warnings: AgentConfigExportWarning[]): AcbAgentEntry[] {
	const entries: AcbAgentEntry[] = [];
	for (const agent of arrayFrom(payload, 'agents')) {
		const name = stringValue(agent, 'name');
		if (!validLength(name, 64)) {
			warnings.push({ code: 'agent-invalid', name: name || undefined });
			continue;
		}
		// The agents endpoint lists disabled registrations for administrators, and
		// governance refuses them before any grant is consulted.
		if (booleanValue(agent, 'enabled') === false) {
			warnings.push({ code: 'agent-disabled', name });
			continue;
		}
		const displayName = stringValue(agent, 'display_name') || name;
		const model = stringValue(agent, 'model');
		const skillIds = stringList(agent.skill_ids).filter((id) => validLength(id, 64));
		entries.push({
			id: name,
			name: displayName.slice(0, 80),
			...(model ? { model: model.slice(0, 128) } : {}),
			skillIds,
		});
	}
	return entries;
}

export function buildAgentConfigPublic(source: AgentConfigExportSource): AgentConfigExportResult {
	const warnings: AgentConfigExportWarning[] = [];
	const pub = emptyPublic();
	pub.models = modelEntries(source.models, warnings);
	pub.mcp = mcpEntries(source.mcpClients, warnings);
	pub.skills = skillEntries(source.skills, warnings);
	pub.prompts = promptEntries(source.prompts, warnings);
	pub.agents = agentEntries(source.agents, warnings);
	return {
		pub,
		capabilities: deriveCapabilities(pub),
		warnings,
		counts: {
			models: pub.models.length,
			mcp: pub.mcp.length,
			skills: pub.skills.length,
			prompts: pub.prompts.length,
			agents: pub.agents.length,
		},
	};
}