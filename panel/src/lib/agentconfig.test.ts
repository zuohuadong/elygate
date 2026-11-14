import { describe, expect, test } from 'bun:test';
import {
	ACB_ENCRYPTION_ALGORITHM,
	ACB_ENCRYPTION_NONE,
	base64ToBytes,
	buildBundle,
	bundleToDeepLink,
	bundleToFileString,
	bytesToBase64,
	decryptSecret,
	extractBundleFromDeepLink,
	parseBundle,
	revealSecret,
	type AcbSecret,
} from './agentconfig';

// Fixed vector from the AgentConfig spec (spec/INTEGRATION.md §7).
const VECTOR_PASSWORD = 'test-vector-2026';
const VECTOR_SALT = 'YWdlbnRjb25maWctdGVzdC1zYWx0LTAwMTY=';
const VECTOR_IV = 'YWNidmVjdG9yczAx';
const VECTOR_CT =
	'XBfk0Lh0iLbzzyOSNRaSNxuaww6dbQMR8ICOeSwLLYS+XSlYz4vBGST8uPEtPcfHBTtx+xGo4uT+DCjszX5nPMa29O3c/iPtfo7cStNq4mc+Qt89T8oBgqtEKbits72djC7y4WScrjo+qwLsPxKTjmuV1HjCdm0QvM8cCQMaYFa8IC/ClKoTW6A6Nk/0TXs/3eYkvQMwA9gneYU9RgE31Pq1UWnPPYOH9ZGm/e5ZdSDH6zXGp1jCtALcZAYgOA86dGR0pb5QWsWoISO2P4Of5T59ZfCiJHAQte9pLjlQk8FKRMpgzgG3bBoK2LJsVddKSZkvbm+iQcjbn3iUzslFjEY=';

const VECTOR_SECRET: AcbSecret = {
	endpoints: { 'provider-a': 'https://api.example.com' },
	customPrompts: { default: 'Be concise.' },
	providerHints: [],
	secrets: {
		'provider-a': { apiKey: 'sk-test-key-abcdef' },
		github: { env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_testtoken123' } },
	},
};

const VECTOR_PUBLIC = {
	mcp: [{ name: 'github', enabled: true, transport: 'stdio' as const, command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'] }],
	models: [{ provider: 'provider-a', id: 'model-x', alias: 'x' }],
	skills: [],
	prompts: [],
	agents: [],
	resources: [],
};

describe('AgentConfig bundle codec', () => {
	test('matches the published encrypted test vector byte for byte', async () => {
		const bundle = await buildBundle({
			label: 'Integration Test Vector',
			src: 'spec',
			trust: 'self',
			hint: 'password is test-vector-2026',
			pub: VECTOR_PUBLIC,
			secret: VECTOR_SECRET,
			password: VECTOR_PASSWORD,
			iterations: 100000,
			salt: base64ToBytes(VECTOR_SALT),
			iv: base64ToBytes(VECTOR_IV),
		});
		expect(bundle.payload.alg).toBe(ACB_ENCRYPTION_ALGORITHM);
		if (bundle.payload.alg !== ACB_ENCRYPTION_ALGORITHM) throw new Error('unreachable');
		expect(bundle.payload.salt).toBe(VECTOR_SALT);
		expect(bundle.payload.iv).toBe(VECTOR_IV);
		expect(bundle.payload.ct).toBe(VECTOR_CT);
	});

	test('decrypts the published test vector', async () => {
		const plaintext = await decryptSecret(
			{ alg: ACB_ENCRYPTION_ALGORITHM, iterations: 100000, salt: VECTOR_SALT, iv: VECTOR_IV, ct: VECTOR_CT },
			VECTOR_PASSWORD,
		);
		expect(JSON.parse(plaintext)).toEqual(VECTOR_SECRET);
	});

	test('round-trips a public bundle through an .acfg file and deep link', async () => {
		const bundle = await buildBundle({ label: 'Public setup', pub: VECTOR_PUBLIC, secret: undefined });
		expect(bundle.trust).toBe('shared');
		expect(bundle.payload.alg).toBe(ACB_ENCRYPTION_NONE);
		const fromFile = parseBundle(bundleToFileString(bundle));
		expect(fromFile).toEqual(bundle);
		const fromLink = extractBundleFromDeepLink(bundleToDeepLink(bundle));
		expect(fromLink).toEqual(bundle);
	});

	test('rejects a shared bundle that carries secrets', async () => {
		await expect(buildBundle({ trust: 'shared', pub: VECTOR_PUBLIC, secret: VECTOR_SECRET, password: VECTOR_PASSWORD })).rejects.toThrow('MUST NOT carry secrets');
		await expect(buildBundle({ trust: 'self', pub: VECTOR_PUBLIC, secret: VECTOR_SECRET })).rejects.toThrow('MUST be password-encrypted');
	});

	test('refuses to reveal secrets from a non-encrypted self bundle', async () => {
		const bundle = parseBundle({
			schema: 'agentconfig-bundle',
			v: 1,
			created: 1,
			trust: 'self',
			capabilities: [],
			payload: { alg: ACB_ENCRYPTION_NONE, ct: bytesToBase64(new TextEncoder().encode(JSON.stringify(VECTOR_SECRET))) },
			pub: VECTOR_PUBLIC,
		});
		await expect(revealSecret(bundle, null)).rejects.toThrow('must be encrypted');
	});

	test('uses the ACB trust rules when revealing an encrypted self bundle', async () => {
		const bundle = await buildBundle({
			trust: 'self',
			pub: VECTOR_PUBLIC,
			secret: VECTOR_SECRET,
			password: VECTOR_PASSWORD,
			salt: base64ToBytes(VECTOR_SALT),
			iv: base64ToBytes(VECTOR_IV),
		});
		expect(await revealSecret(bundle, VECTOR_PASSWORD)).toEqual(VECTOR_SECRET);
		await expect(revealSecret(bundle, 'wrong')).rejects.toThrow();
	});

	test('rejects malformed envelopes instead of guessing', () => {
		expect(() => parseBundle({ schema: 'other', v: 1 })).toThrow('unexpected schema');
		expect(() => parseBundle({ schema: 'agentconfig-bundle', v: 2 })).toThrow('unsupported bundle version');
		expect(() => parseBundle({ schema: 'agentconfig-bundle', v: 1, created: 1, trust: 'shared', capabilities: [], pub: {}, payload: { alg: 'rot13', ct: 'x' } })).toThrow('unsupported payload algorithm');
	});
});