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
	| 'mcp-grants-elsewhere'
	| 'mcp-disabled'
	| 'mcp-no-command'
	| 'mcp-description-redacted'
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
// value, and args travel in the public payload. Anything that names a credential is
// removed: a flag whose name is one (or the next argument after it), a `NAME=value`
// pairing whose name is one, an authentication header, or a bare token-shaped value.
// Dropping too little leaks; dropping too much only means the user must supply that
// argument themselves, so the decision is shape-based rather than statistical.
// Matching runs on the normalized name (letters and digits only), so clientSecret,
// CLIENT_SECRET and client-secret are one word. A bare `key` is deliberately not in
// the flag list: --sort-key and --partition-key are ordinary arguments. It is accepted
// for assignments and header names, where OPENAI_KEY and X-Auth-Token carry secrets.
// `user`/`username`/`login` are on the list because a launch argument spelled that way
// carries a user:password pair for the server it starts.
const SECRET_SUFFIX = /(?:apikey|accesskey|privatekey|token|secret|password|passwd|pwd|auth|authorization|credential|creds|bearer|key|user|username|login|userinfo|cookie|cookies|session|sessionid)$/;
// A bare `key` is a credential unless it names one of these ordinary arguments.
const NOT_A_SECRET_KEY = /^(?:sort|order|partition|primary|foreign|row|cache|group|dedup|map|index|shard|hash|lookup|merge|search|filter|unique|natural|synthetic|stable|join|routing|refresh|schema|object|value)key$/;

function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
const SECRET_TOKEN = /^(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{8,}|github_pat_[a-z0-9_]{8,}|xox[abposr]-[a-z0-9-]{8,}|akia[a-z0-9]{12,}|ey[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})$/i;
const AUTH_HEADER = /^(?:authorization|proxy-authorization|x-api-key|api-key)\s*:/i;
// -H/--header carry arbitrary headers, so they are treated as credential flags.
const HEADER_FLAG = /^(?:h|header|headers|u|user|username|login|userinfo|creds|cookie|cookies)$/i;
// An authentication scheme word that stands on its own after a header name, holding the
// actual secret in the argument after it (Authorization: Bearer <secret>).
const AUTH_SCHEME_WORD = /^(?:bearer|basic|digest|negotiate|ntlm|token|apikey|hmac)$/i;

function isSecretName(name: string): boolean {
	const normalized = normalizeName(name);
	if (!normalized) return false;
	if (NOT_A_SECRET_KEY.test(normalized)) return false;
	return SECRET_SUFFIX.test(normalized);
}

function flagName(token: string): string {
	const trimmed = token.trim().replace(/^--?/, '');
	const separator = trimmed.indexOf('=');
	const name = separator === -1 ? trimmed : trimmed.slice(0, separator);
	return name;
}

// isSecretAssignment finds `NAME=value` anywhere in the token, so `--env=A=B` and a
// bare `OPENAI_API_KEY=...` are both caught.
function isSecretAssignment(token: string): boolean {
	const parts = token.split('=');
	if (parts.length < 2) return false;
	return parts.slice(0, -1).some((part) => isSecretName(part));
}

// A header carries its name before the colon (X-Auth-Token: value).
function isSecretHeader(token: string): boolean {
	const separator = token.indexOf(':');
	if (separator <= 0) return false;
	const name = token.slice(0, separator);
	if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name.trim())) return false;
	return isSecretName(name) || AUTH_HEADER.test(token.trim());
}

// A URL that carries userinfo (https://user:pass@host) authenticates on its own.
const URL_WITH_USERINFO = /[a-z][a-z0-9+.-]*:\/\/[^/\s@]*@/i;
// A signed URL authenticates through its query string (S3 X-Amz-Signature, ?token=,
// ?sig=, ...). Handing it to the public payload is handing over the credential.
const URL_SECRET_QUERY = /[?&](?:x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential|sig|signature|token|access[_-]?token|api[_-]?key|key|secret|password|passwd|pwd|auth|code|ticket)=/i;
// Short flags whose name says nothing: -p is a port in most servers and a password in
// some, so a non-numeric value is treated as the credential it probably is.
const SHORT_CREDENTIAL_FLAG = /^-(?:p|pw)$/i;
const SHORT_CREDENTIAL_ASSIGNMENT = /^-(?:p|pw)=(.*)$/i;

function tokenCarriesSecret(token: string): boolean {
	const trimmed = token.trim().replace(/^(["'])(.*)\1$/, '$2');
	if (!trimmed) return false;
	if (URL_WITH_USERINFO.test(trimmed) || URL_SECRET_QUERY.test(trimmed)) return true;
	if (SECRET_TOKEN.test(trimmed) || AUTH_HEADER.test(trimmed) || isSecretAssignment(trimmed) || isSecretHeader(trimmed)) return true;
	if (!trimmed.startsWith('-')) return false;
	const name = flagName(trimmed);
	return isSecretName(name) || HEADER_FLAG.test(name);
}

// A command line is one string, so it is inspected token by token. Token-level
// matching keeps a subcommand that merely shares a word ("cli auth login") intact, and
// the short-flag rule is applied here too, since `-p secret` is as likely in a command
// line as in an argument list.
function commandCarriesSecret(command: string): boolean {
	const tokens = command.split(/\s+/).map((token) => token.replace(/^(["'])(.*)\1$/, '$2'));
	return tokens.some((token, index) => {
		if (tokenCarriesSecret(token)) return true;
		const assignment = SHORT_CREDENTIAL_ASSIGNMENT.exec(token.trim());
		if (assignment && !/^\d+$/.test(assignment[1].trim())) return true;
		const next = tokens[index + 1] ?? '';
		return SHORT_CREDENTIAL_FLAG.test(token.trim()) && next !== '' && !/^\d+$/.test(next.trim());
	});
}

// afterCredentialFlag returns the index of the last argument belonging to a credential
// flag, starting at the argument after the flag. A header may be spelled out across
// several arguments ("Authorization:", "Bearer", "<secret>"), so prefix-shaped tokens
// are consumed together with the secret they introduce.
function afterCredentialFlag(args: string[], start: number): number {
	let index = start;
	for (let step = 0; step < 3 && index + 1 < args.length; step += 1) {
		const token = (args[index] ?? '').trim();
		const isPrefix = token.endsWith(':') || AUTH_SCHEME_WORD.test(token);
		if (!isPrefix) break;
		index += 1;
	}
	return index;
}

function redactArgs(args: string[]): { args: string[]; redacted: boolean } {
	const kept: string[] = [];
	let redacted = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (tokenCarriesSecret(arg)) {
			redacted = true;
			// A flag with no inline value carries the credential in the next argument,
			// so that one goes too. A bare assignment carries its own value already.
			// A separate value belongs to the credential either way: `--key value` and
			// `OPENAI_KEY:` + value both carry it in the next argument. When the next
			// argument is only a scheme word (Bearer), the secret is the one after it.
			const separatorOnly = arg.trim().endsWith(':');
			const inline = !separatorOnly && (arg.includes('=') || !arg.trim().startsWith('-'));
			if (!inline && index + 1 < args.length) index = afterCredentialFlag(args, index + 1);
			continue;
		}
		// A flag whose only value is a credential loses the flag too: leaving it behind
		// would hand the client an argument the server cannot parse.
		const shortAssignment = SHORT_CREDENTIAL_ASSIGNMENT.exec(arg.trim());
		if (shortAssignment && !/^\d+$/.test(shortAssignment[1].trim())) {
			redacted = true;
			continue;
		}
		const next = index + 1 < args.length ? args[index + 1] : '';
		if (SHORT_CREDENTIAL_FLAG.test(arg.trim()) && next !== '' && !/^\d+$/.test(next.trim())) {
			redacted = true;
			index += 1;
			continue;
		}
		if (arg.trim().endsWith(':') && next !== '' && AUTH_SCHEME_WORD.test(next.trim())) {
			// `Authorization:` then `Bearer` then the secret.
			redacted = true;
			index = afterCredentialFlag(args, index);
			continue;
		}
		if (arg.trim().startsWith('-') && !arg.includes('=') && next !== '' && !next.trim().startsWith('-') && tokenCarriesSecret(next)) {
			redacted = true;
			index += 1;
			continue;
		}
		kept.push(arg);
	}
	return { args: kept, redacted };
}

// A description is free text, so it can carry a pasted credential. It is checked with the
// same rules as an argument and dropped entirely when it matches, rather than trimmed: a
// partially redacted sentence reads like a redaction that missed.
function descriptionField(config: JsonRecord, name: string, warnings: AgentConfigExportWarning[]): { description?: string } {
	const description = stringValue(config, 'description');
	if (!description) return {};
	if (commandCarriesSecret(description)) {
		warnings.push({ code: 'mcp-description-redacted', name });
		return {};
	}
	return { description: description.slice(0, 200) };
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
		const clientTools = config.tools_to_execute;
		// A client whose own allow-list withholds tools cannot be represented in ACB (no
		// per-tool field), and the bundle's entry starts the server itself. An absent list
		// means the same thing to callers as an empty one: no reachable tools
		// (core/mcp/connect.go, core/mcp/utils.go shouldSkipToolForConfig).
		if (!Array.isArray(clientTools) || !(clientTools.length === 1 && clientTools[0] === '*')) {
			warnings.push({ code: 'mcp-tools-restricted', name });
			continue;
		}
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
		if (!command) {
			// Args without a command produce an entry nothing can start.
			warnings.push({ code: 'mcp-no-command', name });
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
			...descriptionField(config, name, warnings),
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