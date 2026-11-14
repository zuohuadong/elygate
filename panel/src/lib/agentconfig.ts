// AgentConfig Bundle (ACB) v1 encoder/decoder.
//
// Format: https://github.com/vibeunion/agentconfig (Draft v1.1).
// This is a browser-native implementation so the panel does not need the
// Node-only reference package at runtime. It is byte-compatible with the
// published test vector in spec/INTEGRATION.md.

export const ACB_SCHEMA_ID = 'agentconfig-bundle';
export const ACB_VERSION = 1;
export const ACB_DEEP_LINK_SCHEME = 'agentconfig';
export const ACB_DEEP_LINK_MAX_BYTES = 20000;
export const ACB_FILE_EXTENSION = '.acfg';
export const ACB_MIME_TYPE = 'application/x-agentconfig+json';
export const ACB_PBKDF2_MIN_ITERATIONS = 100000;
export const ACB_MAX_BUNDLE_BYTES = 1_000_000;

export const ACB_ENCRYPTION_ALGORITHM = 'PBKDF2-SHA256-AES-256-GCM';
export const ACB_ENCRYPTION_NONE = 'none';

export const ACB_TRUST_MODES = ['self', 'shared', 'managed'] as const;
export type AcbTrustMode = (typeof ACB_TRUST_MODES)[number];

export const ACB_CAPABILITIES = ['mcp', 'models', 'skills', 'prompts', 'agents', 'resources'] as const;
export type AcbCapability = (typeof ACB_CAPABILITIES)[number];

export interface AcbMcpEntry {
	name: string;
	enabled: boolean;
	transport: 'stdio' | 'sse' | 'http';
	command?: string;
	args: string[];
	envKeys: string[];
	registryId?: string;
	repoUrl?: string;
	description?: string;
}

export interface AcbModelEntry {
	provider: string;
	id: string;
	alias?: string;
	maxTokens?: number;
}

export interface AcbSkillEntry {
	id: string;
	enabled: boolean;
	order?: number;
}

export interface AcbPromptEntry {
	id: string;
	title?: string;
}

export interface AcbAgentEntry {
	id: string;
	name?: string;
	model?: string;
	skillIds: string[];
}

export interface AcbResourceEntry {
	uri: string;
	name?: string;
	mimeType?: string;
}

export interface AcbPublic {
	mcp: AcbMcpEntry[];
	models: AcbModelEntry[];
	skills: AcbSkillEntry[];
	prompts: AcbPromptEntry[];
	agents: AcbAgentEntry[];
	resources: AcbResourceEntry[];
}

export interface AcbProviderSecret {
	apiKey?: string;
	env?: Record<string, string>;
	headers?: Record<string, string>;
	oauth?: Record<string, unknown> & { type: string };
}

export interface AcbSecret {
	endpoints: Record<string, string>;
	customPrompts: Record<string, string>;
	providerHints: { provider: string; baseUrl?: string }[];
	secrets: Record<string, AcbProviderSecret>;
}

export interface AcbEncryptedPayload {
	alg: typeof ACB_ENCRYPTION_ALGORITHM;
	iterations: number;
	salt: string;
	iv: string;
	ct: string;
}

export interface AcbPlainPayload {
	alg: typeof ACB_ENCRYPTION_NONE;
	ct: string;
}

export type AcbPayload = AcbEncryptedPayload | AcbPlainPayload;

export interface AcbBundle {
	schema: typeof ACB_SCHEMA_ID;
	v: typeof ACB_VERSION;
	created: number;
	label?: string;
	src?: string;
	trust: AcbTrustMode;
	capabilities: AcbCapability[];
	hint?: string;
	payload: AcbPayload;
	pub: AcbPublic;
	[key: string]: unknown;
}

export interface BuildBundleInput {
	label?: string;
	src?: string;
	trust?: AcbTrustMode;
	capabilities?: AcbCapability[];
	hint?: string;
	pub: Partial<AcbPublic>;
	secret?: Partial<AcbSecret>;
	password?: string;
	iterations?: number;
	created?: number;
	salt?: Uint8Array;
	iv?: Uint8Array;
}

export function emptyPublic(): AcbPublic {
	return { mcp: [], models: [], skills: [], prompts: [], agents: [], resources: [] };
}

export function emptySecret(): AcbSecret {
	return { endpoints: {}, customPrompts: {}, providerHints: [], secrets: {} };
}

export function hasSecrets(secret: Partial<AcbSecret> | undefined): boolean {
	return Object.keys(secret?.secrets ?? {}).length > 0;
}

export function deriveCapabilities(pub: Partial<AcbPublic>): AcbCapability[] {
	const capabilities: AcbCapability[] = [];
	for (const capability of ACB_CAPABILITIES) {
		if ((pub[capability]?.length ?? 0) > 0) capabilities.push(capability);
	}
	return capabilities;
}

function normalizePublic(pub: Partial<AcbPublic> | undefined): AcbPublic {
	return {
		mcp: [...(pub?.mcp ?? [])],
		models: [...(pub?.models ?? [])],
		skills: [...(pub?.skills ?? [])],
		prompts: [...(pub?.prompts ?? [])],
		agents: [...(pub?.agents ?? [])],
		resources: [...(pub?.resources ?? [])],
	};
}

function normalizeSecret(secret: Partial<AcbSecret> | undefined): AcbSecret {
	return {
		endpoints: { ...(secret?.endpoints ?? {}) },
		customPrompts: { ...(secret?.customPrompts ?? {}) },
		providerHints: [...(secret?.providerHints ?? [])],
		secrets: { ...(secret?.secrets ?? {}) },
	};
}

function cryptoApi(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('Web Crypto is unavailable in this browser');
	return subtle;
}

function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	return base64ToBytes(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
	const subtle = cryptoApi();
	const material = await subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey'],
	);
	return subtle.deriveKey(
		{ name: 'PBKDF2', salt: asBufferSource(salt), iterations, hash: 'SHA-256' },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

export async function encryptSecret(
	plaintext: string,
	password: string,
	options: { iterations?: number; salt?: Uint8Array; iv?: Uint8Array } = {},
): Promise<AcbEncryptedPayload> {
	const iterations = options.iterations ?? ACB_PBKDF2_MIN_ITERATIONS;
	if (!Number.isInteger(iterations) || iterations < ACB_PBKDF2_MIN_ITERATIONS) {
		throw new Error(`iterations must be an integer >= ${ACB_PBKDF2_MIN_ITERATIONS}`);
	}
	const salt = options.salt ?? randomBytes(16);
	const iv = options.iv ?? randomBytes(12);
	if (salt.length === 0) throw new Error('salt must not be empty');
	if (iv.length !== 12) throw new Error('iv must be 12 bytes');
	const key = await deriveKey(password, salt, iterations);
	const ciphertext = new Uint8Array(
		await cryptoApi().encrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, key, new TextEncoder().encode(plaintext)),
	);
	return {
		alg: ACB_ENCRYPTION_ALGORITHM,
		iterations,
		salt: bytesToBase64(salt),
		iv: bytesToBase64(iv),
		ct: bytesToBase64(ciphertext),
	};
}

export async function decryptSecret(payload: AcbEncryptedPayload, password: string): Promise<string> {
	if (payload.alg !== ACB_ENCRYPTION_ALGORITHM) throw new Error('payload is not encrypted');
	if (!Number.isInteger(payload.iterations) || payload.iterations < ACB_PBKDF2_MIN_ITERATIONS) {
		throw new Error('payload iterations are below the ACB minimum');
	}
	const key = await deriveKey(password, base64ToBytes(payload.salt), payload.iterations);
	const plaintext = await cryptoApi().decrypt(
		{ name: 'AES-GCM', iv: asBufferSource(base64ToBytes(payload.iv)) },
		key,
		asBufferSource(base64ToBytes(payload.ct)),
	);
	return new TextDecoder().decode(plaintext);
}

export async function buildBundle(input: BuildBundleInput): Promise<AcbBundle> {
	const trust = input.trust ?? 'shared';
	const pub = normalizePublic(input.pub);
	const secret = normalizeSecret(input.secret);
	const capabilities = input.capabilities ?? deriveCapabilities(pub);
	const label = input.label?.trim() || undefined;

	if (trust === 'shared' && hasSecrets(secret)) {
		throw new Error('shared bundles MUST NOT carry secrets; use trust="self" or "managed" with a password');
	}
	if (trust !== 'shared' && hasSecrets(secret) && !input.password) {
		throw new Error(`trust="${trust}" bundles carrying secrets MUST be password-encrypted`);
	}

	let payload: AcbPayload;
	if (input.password) {
		payload = await encryptSecret(JSON.stringify(secret), input.password, {
			iterations: input.iterations,
			salt: input.salt,
			iv: input.iv,
		});
	} else {
		payload = {
			alg: ACB_ENCRYPTION_NONE,
			ct: bytesToBase64(new TextEncoder().encode(JSON.stringify(secret))),
		};
	}

	const bundle: AcbBundle = {
		schema: ACB_SCHEMA_ID,
		v: ACB_VERSION,
		created: input.created ?? Date.now(),
		...(label ? { label } : {}),
		...(input.src ? { src: input.src } : {}),
		trust,
		capabilities,
		...(input.hint ? { hint: input.hint } : {}),
		payload,
		pub,
	};
	assertBundle(bundle);
	return bundle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	return typeof record[key] === 'string' ? record[key] : undefined;
}

export function assertBundle(value: unknown): asserts value is AcbBundle {
	if (!isRecord(value)) throw new Error('bundle must be a JSON object');
	if (value.schema !== ACB_SCHEMA_ID) throw new Error(`unexpected schema: ${String(value.schema)}`);
	if (value.v !== ACB_VERSION) throw new Error(`unsupported bundle version: ${String(value.v)}`);
	if (typeof value.created !== 'number' || !Number.isInteger(value.created) || value.created < 0) {
		throw new Error('created must be a non-negative integer');
	}
	if (!ACB_TRUST_MODES.includes(value.trust as AcbTrustMode)) {
		throw new Error(`unexpected trust mode: ${String(value.trust)}`);
	}
	if (!Array.isArray(value.capabilities)) throw new Error('capabilities must be an array');
	if (!isRecord(value.pub)) throw new Error('pub must be an object');
	if (!isRecord(value.payload)) throw new Error('payload must be an object');
	const payload = value.payload;
	if (payload.alg !== ACB_ENCRYPTION_ALGORITHM && payload.alg !== ACB_ENCRYPTION_NONE) {
		throw new Error(`unsupported payload algorithm: ${String(payload.alg)}`);
	}
	if (payload.alg === ACB_ENCRYPTION_ALGORITHM) {
		if (typeof payload.iterations !== 'number' || payload.iterations < ACB_PBKDF2_MIN_ITERATIONS) {
			throw new Error('payload iterations are below the ACB minimum');
		}
		for (const field of ['salt', 'iv', 'ct']) {
			if (typeof payload[field] !== 'string' || !payload[field]) throw new Error(`payload.${field} is required`);
		}
	} else if (typeof payload.ct !== 'string' || !payload.ct) {
		throw new Error('payload.ct is required');
	}
}

export function parseBundle(value: unknown): AcbBundle {
	const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
	assertBundle(parsed);
	const bundle = parsed as AcbBundle;
	bundle.pub = normalizePublic(bundle.pub);
	return bundle;
}

export function bundleToFileString(bundle: AcbBundle): string {
	assertBundle(bundle);
	const text = JSON.stringify(bundle, null, 2);
	if (new TextEncoder().encode(text).length > ACB_MAX_BUNDLE_BYTES) {
		throw new Error(`bundle exceeds the ${ACB_MAX_BUNDLE_BYTES} byte ACB limit`);
	}
	return text;
}

export function bundleToDeepLink(bundle: AcbBundle): string {
	assertBundle(bundle);
	const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(bundle)));
	if (encoded.length > ACB_DEEP_LINK_MAX_BYTES) {
		throw new Error(`bundle is too large for a deep link; use the ${ACB_FILE_EXTENSION} file instead`);
	}
	return `${ACB_DEEP_LINK_SCHEME}://import?v=${bundle.v}&bundle=${encoded}`;
}

export function extractBundleFromDeepLink(url: string): AcbBundle {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error('invalid deep link');
	}
	if (parsed.protocol !== `${ACB_DEEP_LINK_SCHEME}:`) throw new Error('unexpected deep link scheme');
	if (parsed.hostname !== 'import') throw new Error('unexpected deep link host');
	const encoded = parsed.searchParams.get('bundle');
	if (!encoded) throw new Error('missing bundle parameter');
	const bytes = base64UrlToBytes(encoded);
	if (bytes.byteLength > ACB_MAX_BUNDLE_BYTES) throw new Error('bundle exceeds the ACB size limit');
	return parseBundle(new TextDecoder().decode(bytes));
}

export function isPasswordRequired(bundle: AcbBundle): boolean {
	return bundle.payload.alg === ACB_ENCRYPTION_ALGORITHM;
}

export async function revealSecret(bundle: AcbBundle, password: string | null): Promise<AcbSecret> {
	const { payload } = bundle;
	let secret: AcbSecret;
	if (payload.alg === ACB_ENCRYPTION_NONE) {
		secret = normalizeSecret(JSON.parse(new TextDecoder().decode(base64ToBytes(payload.ct))) as Partial<AcbSecret>);
	} else {
		if (!password) throw new Error('password required');
		secret = normalizeSecret(JSON.parse(await decryptSecret(payload, password)) as Partial<AcbSecret>);
	}
	if (bundle.trust === 'shared' && hasSecrets(secret)) {
		throw new Error('a shared bundle must not carry secrets');
	}
	if (bundle.trust !== 'shared' && hasSecrets(secret) && payload.alg === ACB_ENCRYPTION_NONE) {
		throw new Error('a self/managed bundle carrying secrets must be encrypted');
	}
	return secret;
}

export function suggestedBundleFilename(bundle: AcbBundle): string {
	const label = (bundle.label ?? 'agentconfig')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 60);
	return `${label || 'agentconfig'}${ACB_FILE_EXTENSION}`;
}

// Exported for tests and for UI display of a deep link preview.
export function bundleByteLength(bundle: AcbBundle): number {
	return new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
}