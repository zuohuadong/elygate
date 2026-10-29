import { describe, expect, test } from 'bun:test';
import { buildRelayPayload, emptyRelayDraft, relayAuthTypes, relayDraftFromConfig, relayLogParams } from './relay-management';
import { relayGrantNames, relayGrantsPayload } from './relay-grants';

function draft() {
	return { ...emptyRelayDraft(), name: 'example', baseUrl: 'https://api.example.test/v1', credentialValue: 'test-only' };
}

describe('relay management contracts', () => {
	test('supports all upstream auth schemes', () => {
		for (const authType of relayAuthTypes) {
			const form = { ...draft(), authType, headerName: 'X-Api-Key', queryParam: 'api_key', awsService: 'textract', awsRegion: 'us-east-1' };
			const payload = buildRelayPayload(form);
			expect(payload.auth).toMatchObject({ type: authType });
			if (authType === 'none') expect(payload.credential).toBeUndefined();
			else if (authType === 'aws_sigv4') expect(payload.credential).toEqual({ aws: { region: 'us-east-1' } });
			else expect(payload.credential).toEqual({ value: 'test-only' });
		}
	});

	test('round-trips full replacement configuration and redacted secrets', () => {
		const config = {
			name: 'example', description: 'Endpoint', base_url: 'https://api.example.test/v1',
			auth: { type: 'header', header_name: 'X-Api-Key', value_prefix: 'Token ' },
			credential: { value: { value: '********', ref: 'env.RELAY_KEY', type: 'env' } },
			extra_headers: { 'X-Functions-Key': { value: '********' } },
			network: { timeout_seconds: 120 }, proxy_config: { type: 'http', url: 'http://proxy.test' },
			usage: { cost_per_request: 0.01 }, streaming: { paths: ['/stream/**'] },
			routes: [{ method: 'HEAD', path: '/**', billable: false }],
			skip_route_check: true, ignore_upstream_cost: true,
		};
		expect(JSON.parse(JSON.stringify(buildRelayPayload(relayDraftFromConfig(config), config.name)))).toEqual(config);
	});

	test('does not replace absent proxy or network inheritance with empty objects', () => {
		const form = relayDraftFromConfig({
			name: 'example', base_url: 'https://api.example.test', auth: { type: 'none' },
			proxy_config: null, network: null, streaming: null, usage: null,
		});
		const payload = buildRelayPayload(form, 'example');
		for (const key of ['proxy_config', 'network', 'streaming', 'usage', 'credential']) expect(Object.hasOwn(payload, key)).toBe(false);
		form.proxyConfigJson = '{}';
		expect(buildRelayPayload(form, 'example').proxy_config).toEqual({});
	});

	test('replaces a token only when a new literal is entered', () => {
		const form = relayDraftFromConfig({
			name: 'example', base_url: 'https://api.example.test',
			auth: { type: 'bearer' }, credential: { value: { value: '********', ref: 'env.KEY' } },
		});
		expect(buildRelayPayload(form).credential).toEqual({ value: { value: '********', ref: 'env.KEY' } });
		form.credentialValue = 'replacement-test-only';
		expect(buildRelayPayload(form).credential).toEqual({ value: 'replacement-test-only' });
	});

	test('preserves AWS secret references while changing only the signing region', () => {
		const credential = {
			aws: {
				region: { value: 'us-east-1' }, access_key: { ref: 'env.AWS_ACCESS_KEY', value: '********' },
				secret_key: { ref: 'env.AWS_SECRET_KEY', value: '********' }, session_token: { value: '********' },
				role_arn: { value: 'arn:aws:iam::123456789012:role/test' },
			},
		};
		const form = relayDraftFromConfig({ name: 'aws', base_url: 'https://textract.example.test', auth: { type: 'aws_sigv4', aws: { service: 'textract' } }, credential });
		expect(form.awsRegion).toBe('us-east-1');
		expect(buildRelayPayload(form, 'aws').credential).toEqual(credential);
		form.awsRegion = 'eu-west-1';
		expect(buildRelayPayload(form, 'aws').credential).toEqual({ aws: { ...credential.aws, region: 'eu-west-1' } });
	});

	test('preserves a referenced AWS region and explicit advanced JSON edits', () => {
		const form = relayDraftFromConfig({
			name: 'aws', base_url: 'https://aws.example.test', auth: { type: 'aws_sigv4', aws: { service: 'translate' } },
			credential: { aws: { region: { ref: 'env.AWS_REGION', value: '********', type: 'env' } } },
		});
		expect(form.awsRegion).toBe('env.AWS_REGION');
		expect(buildRelayPayload(form).credential).toEqual({ aws: { region: { ref: 'env.AWS_REGION', value: '********', type: 'env' } } });
		form.credentialJson = '{"aws":{"region":"ap-southeast-1","role_arn":"test-role"}}';
		expect(buildRelayPayload(form).credential).toEqual({ aws: { region: 'ap-southeast-1', role_arn: 'test-role' } });
	});

	test('rejects invalid or changed endpoint identity', () => {
		for (const name of ['', '.', '..', 'a/b', 'a b', 'x'.repeat(65)]) expect(() => buildRelayPayload({ ...draft(), name })).toThrow();
		expect(() => buildRelayPayload(draft(), 'different')).toThrow('name-immutable');
		expect(buildRelayPayload({ ...draft(), name: 'Case._-123' }).name).toBe('Case._-123');
	});

	test('rejects unsafe or malformed base URLs', () => {
		for (const baseUrl of ['', 'relative', 'file:///tmp/test', 'https://user:pass@example.test', 'https://example.test?x=1', 'https://example.test/#fragment']) {
			expect(() => buildRelayPayload({ ...draft(), baseUrl })).toThrow();
		}
	});

	test('enforces object and array JSON shapes without losing the draft', () => {
		for (const key of ['extraHeadersJson', 'networkJson', 'proxyConfigJson', 'usageJson', 'streamingJson', 'credentialJson'] as const) {
			for (const json of ['{', '[]', 'null', 'false', '"value"']) {
				const form = { ...draft(), credentialValue: '', credentialJson: '{"value":"test-only"}', [key]: json };
				expect(() => buildRelayPayload(form)).toThrow();
				expect(form[key]).toBe(json);
			}
		}
		for (const routesJson of ['{}', 'null', '{']) expect(() => buildRelayPayload({ ...draft(), routesJson })).toThrow();
	});

	test('requires auth-specific fields', () => {
		expect(() => buildRelayPayload({ ...draft(), authType: 'header' })).toThrow('header-name-required');
		expect(() => buildRelayPayload({ ...draft(), authType: 'query' })).toThrow('query-param-required');
		expect(() => buildRelayPayload({ ...draft(), authType: 'aws_sigv4' })).toThrow('aws-region-required');
		expect(() => buildRelayPayload({ ...draft(), credentialValue: '' })).toThrow('credential-required');
	});

	test('uses server-supported log filters and a deterministic absolute time window', () => {
		const now = Date.parse('2026-10-30T12:00:00Z');
		const filters = { search: ' request ', relayName: 'Case', method: 'HEAD', status: 'error', kind: 'call', period: '24h' };
		const params = relayLogParams(filters, now);
		expect(Object.fromEntries(params)).toEqual({
			start_time: '2026-10-29T12:00:00.000Z', end_time: '2026-10-30T12:00:00.000Z',
			search: 'request', relay_names: 'Case', methods: 'HEAD', statuses: 'error', kinds: 'call',
		});
		expect(params.has('period')).toBe(false);
		for (const [period, hours] of [['1h', 1], ['7d', 168], ['30d', 720]] as const) {
			expect(Date.parse(relayLogParams({ ...filters, period }, now).get('start_time')!)).toBe(now - hours * 3_600_000);
		}
		expect(() => relayLogParams({ ...filters, period: 'invalid' }, now)).toThrow('invalid-log-period');
	});
});

describe('virtual key relay grant contracts', () => {
	test('retains exact endpoint identities and discards database fields', () => {
		expect(relayGrantNames([{ id: 1, virtual_key_id: 'vk', relay_name: 'Case' }, { relay_name: 'case' }])).toEqual(['Case', 'case']);
		expect(relayGrantNames(null)).toEqual([]);
		expect(relayGrantNames(undefined)).toEqual([]);
	});

	test('omits unchanged grants, including reorder, but explicitly clears removed grants', () => {
		expect(relayGrantsPayload(['b', 'a'], ['a', 'b'])).toBeUndefined();
		expect(relayGrantsPayload([], [])).toBeUndefined();
		expect(relayGrantsPayload([], ['a'])).toEqual([]);
		expect(relayGrantsPayload(['a', 'B'], ['a', 'b'])).toEqual([{ relay_name: 'a' }, { relay_name: 'B' }]);
		expect(relayGrantsPayload([])).toEqual([]);
	});

	test('rejects malformed grants instead of broadening or clearing permissions', () => {
		for (const grants of [{}, 'a', [null], [{ name: 'a' }], [{ relay_name: '.' }], [{ relay_name: 'a/b' }], [{ relay_name: 'a' }, { relay_name: 'a' }]]) {
			expect(() => relayGrantNames(grants)).toThrow('invalid-relay-grants');
		}
		expect(() => relayGrantsPayload(['a', 'a'])).toThrow('invalid-relay-grants');
	});
});
