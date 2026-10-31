import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'bun:test';
import { buildRelayPayload, emptyRelayDraft, relayDraftFromConfig, relayLogParams, emptyRelayLogFilters } from '../../src/lib/relay-management';
import { relayRulesFromJson, relayRulesToJson } from '../../src/lib/relay-rules';
import { collectRelayLogExport, relayLogListUrl, relayLogPage, relayLogsToCsv } from '../../src/lib/relay-log-export';
import type { JsonRecord } from '../../src/lib/api';
import { availablePort, trackedChild, stopChild, waitFor, waitForHTTP, type RuntimeChild } from './process';
import { PrivatePostgres } from './postgres';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function prepareConfig(appDir: string, postgres?: PrivatePostgres): Promise<void> {
	for (const [name, content] of Object.entries({ pricing: '{}', parameters: '{}', library: '{"servers":[]}' })) {
		await writeFile(path.join(appDir, `${name}.json`), content, { mode: 0o600 });
	}
	const catalogURL = (name: string) => pathToFileURL(path.join(appDir, `${name}.json`)).href;
	await writeFile(path.join(appDir, 'config.json'), JSON.stringify({
		...postgres?.stores(),
		client: { allowed_origins: [], log_retention_days: 0 },
		providers: {},
		governance: { auth_config: {
			is_enabled: true, admin_username: 'relay-acceptance',
			admin_password: 'env.ELYGATE_RELAY_TEST_PASSWORD',
		} },
		framework: { pricing: {
			pricing_url: catalogURL('pricing'), model_parameters_url: catalogURL('parameters'),
			mcp_library_url: catalogURL('library'),
		} },
		plugins: [{ name: 'logging', enabled: true, config: {} }, { name: 'governance', enabled: true, config: {} }],
	}), { mode: 0o600 });
}

function relayPayload(upstream: string): JsonRecord {
	const draft = { ...emptyRelayDraft(), name: 'runtime-acceptance', baseUrl: upstream,
		credentialValue: 'env.ELYGATE_RELAY_TEST_UPSTREAM_KEY' };
	const rules = relayRulesFromJson({
		usageJson: JSON.stringify({ cost_per_request: 0.001, cost_per_unit: 0.01, units_path: 'usage.credits',
			input_tokens_path: 'usage.input_tokens', output_tokens_path: 'usage.output_tokens' }),
		streamingJson: JSON.stringify({ paths: ['/v1/stream'] }),
		routesJson: JSON.stringify([
			{ method: 'POST', path: '/v1/search', headers: { 'X-Operation': 'search*' } },
			{ method: 'POST', path: '/v1/stream', stream: true },
			{ method: 'POST', path: '/v1/free', billable: false },
			{ method: 'POST', path: '/v1/fail' },
			{ method: 'POST', path: '/v1/disabled', enabled: false },
			{ method: 'GET', path: '/v1/echo' },
		]),
	});
	return buildRelayPayload({ ...draft, ...relayRulesToJson(rules) });
}

function apiClient(origin: string) {
	let cookie = '';
	return {
		async request(route: string, options: RequestInit = {}): Promise<Response> {
			const headers = new Headers(options.headers);
			headers.set('Origin', origin);
			headers.set('Content-Type', 'application/json');
			if (cookie) headers.set('Cookie', cookie);
			const response = await fetch(origin + route, { ...options, headers, signal: AbortSignal.timeout(10_000) });
			const session = response.headers.get('set-cookie');
			if (session) cookie = session.split(';')[0];
			return response;
		},
		async json(route: string, options: { method?: string; body?: unknown; status?: number } = {}): Promise<JsonRecord> {
			const response = await this.request(route, {
				method: options.method ?? 'GET', body: options.body === undefined ? undefined : JSON.stringify(options.body),
			});
			assert.equal(response.status, options.status ?? 200, `${options.method ?? 'GET'} ${route}`);
			return response.json();
		},
	};
}

type ApiClient = ReturnType<typeof apiClient>;

async function runtimeSecrets(appDir: string): Promise<Record<string, string>> {
	const secretsDir = path.join(appDir, 'private');
	const filename = path.join(secretsDir, 'runtime-env.json');
	assert.equal((await stat(secretsDir)).mode & 0o777, 0o700);
	assert.equal((await stat(filename)).mode & 0o777, 0o600);
	const bundle: unknown = JSON.parse(await readFile(filename, 'utf8'));
	assert.ok(bundle && typeof bundle === 'object' && !Array.isArray(bundle));
	assert.ok(['ELYGATE_RELAY_TEST_PASSWORD', 'ELYGATE_RELAY_TEST_UPSTREAM_KEY', 'ELYGATE_RELAY_TEST_PG_PASSWORD']
		.every(name => name in bundle), 'runtime secret bundle must contain all required credentials');
	assert.ok(Object.values(bundle).every(secret => typeof secret === 'string' && secret.length > 0),
		'restored runtime secrets must contain nonempty strings');
	return bundle as Record<string, string>;
}

async function useLiteralRelayCredential(api: ApiClient, upstreamKey: string): Promise<void> {
	const saved = await api.json('/api/relays/runtime-acceptance');
	const draft = { ...relayDraftFromConfig(saved), credentialValue: upstreamKey,
		extraHeadersJson: JSON.stringify({ 'X-Recovery-Secret': upstreamKey }) };
	const updated = await api.json('/api/relays/runtime-acceptance', {
		method: 'PUT', body: buildRelayPayload(draft, 'runtime-acceptance'),
	});
	assert.ok(!JSON.stringify(updated).includes(upstreamKey), 'literal credentials must stay redacted');
	const roundTrip = await api.json('/api/relays/runtime-acceptance', {
		method: 'PUT', body: buildRelayPayload(relayDraftFromConfig(updated), 'runtime-acceptance'),
	});
	assert.ok(!JSON.stringify(roundTrip).includes(upstreamKey), 'redacted updates must not expose credentials');
}

async function verifyEncryptedStore(postgres: PrivatePostgres, upstreamKey: string): Promise<void> {
	const relay = JSON.parse(await postgres.queryConfig(`SELECT row_to_json(snapshot) FROM
		(SELECT encryption_status, credential_value, extra_headers_json FROM config_relays
			WHERE name = 'runtime-acceptance') AS snapshot`));
	assert.equal(relay.encryption_status, 'encrypted');
	for (const column of ['credential_value', 'extra_headers_json']) {
		assert.ok(typeof relay[column] === 'string' && relay[column].length > 0 && !relay[column].includes(upstreamKey),
			`${column} must retain encrypted, not plaintext, literal credentials`);
	}
	for (const table of ['sessions', 'governance_virtual_keys']) {
		const rows = JSON.parse(await postgres.queryConfig(`SELECT json_build_object('rows', count(*),
			'encrypted', bool_and(encryption_status = 'encrypted')) FROM ${table}`));
		assert.ok(rows.rows > 0 && rows.encrypted === true, `${table} must contain encrypted credentials`);
	}
}

async function signedAuditSnapshot(api: ApiClient): Promise<{ chain: JsonRecord; publicKey: JsonRecord }> {
	const chain = await api.json('/api/governance/audit-logs/verify');
	assert.equal(chain.valid, true);
	assert.ok(Number(chain.head_sequence) > 0, 'signed audit chain must not be empty');
	assert.equal(chain.checked_through_sequence, chain.head_sequence);
	return { chain, publicKey: await api.json('/api/governance/audit-logs/public-key') };
}

async function verifyRecoveredLogin(origin: string, appDir: string): Promise<void> {
	const secrets = await runtimeSecrets(appDir);
	const api = apiClient(origin);
	await api.json('/api/session/login', { method: 'POST', body: {
		username: 'relay-acceptance', password: secrets.ELYGATE_RELAY_TEST_PASSWORD,
	} });
	await api.json('/api/relays/runtime-acceptance');
	await api.json('/api/session/logout', { method: 'POST' });
	await api.json('/api/relays/runtime-acceptance', { status: 401 });
}

interface RuntimeApplicationKey {
	applicationID: string;
	key: string;
	virtualKeyID: string;
	expiresAt?: string;
}

async function applicationKey(api: ApiClient, lifetimeMs?: number): Promise<RuntimeApplicationKey> {
	const project = await api.json('/api/control-plane/projects', { method: 'POST', body: { name: 'Relay acceptance' }, status: 201 });
	const application = await api.json(`/api/control-plane/projects/${project.id}/applications`, {
		method: 'POST', body: { name: 'Relay runtime' }, status: 201,
	});
	const key = await api.json(`/api/control-plane/applications/${application.id}/keys`, {
		method: 'POST', body: { name: `Relay runtime ${application.id}`,
			...(lifetimeMs === undefined ? {} : { expires_at: new Date(Date.now() + lifetimeMs).toISOString() }) }, status: 201,
	});
	assert.equal(typeof key.value, 'string');
	assert.equal(typeof key.virtual_key_id, 'string');
	return { applicationID: String(application.id), key: String(key.value), virtualKeyID: String(key.virtual_key_id),
		expiresAt: typeof key.expires_at === 'string' ? key.expires_at : undefined };
}

async function verifyPreviewAndSave(api: ApiClient, upstream: string): Promise<void> {
	const config = relayPayload(upstream);
	const preview = await api.json('/api/relays/usage-preview', { method: 'POST', body: {
		config, sample: { method: 'POST', path: '/v1/search', headers: { 'X-Operation': 'search' },
			response_content_type: 'application/json', response_body: '{"usage":{"credits":4}}' },
	} });
	assert.equal(preview.route_allowed, true);
	assert.equal(preview.counted, true);
	assert.ok(Math.abs(Number(preview.cost) - 0.041) < 1e-9);
	assert.equal((await api.json('/api/relays')).total_count, 0, 'preview must not save the draft');
	const saved = await api.json('/api/relays', { method: 'POST', body: config, status: 201 });
	const credential = saved.credential as JsonRecord;
	assert.equal((credential.value as JsonRecord).ref, 'env.ELYGATE_RELAY_TEST_UPSTREAM_KEY');
	assert.match(String((credential.value as JsonRecord).value), /\*{8,}|<REDACTED>/);
	const updated = buildRelayPayload({ ...relayDraftFromConfig(saved), description: 'round-trip update' }, String(saved.name));
	const replacement = await api.json(`/api/relays/${saved.name}`, { method: 'PUT', body: updated });
	assert.equal(replacement.description, 'round-trip update');
}

async function verifyDeniedGrant(api: ApiClient, key: string, upstream: string): Promise<void> {
	// 未授权请求必须在触达上游前被拦截，而不只是返回一个错误状态。
	await verifySearch(api, { key, tag: 'no-grant', status: 403 });
	await verifyUpstreamHits(upstream, 'no-grant', 0);
}

async function verifySearch(api: ApiClient, call: { key: string; tag: string; status: number }): Promise<void> {
	const response = await api.request(`/relay/runtime-acceptance/v1/search?tag=${call.tag}`, {
		method: 'POST', body: '{}', headers: { 'x-bf-vk': call.key, 'X-Operation': 'search' },
	});
	assert.equal(response.status, call.status, call.tag);
	await response.arrayBuffer();
}

async function verifyUpstreamHits(upstream: string, tag: string, expected: number): Promise<void> {
	const hits = await fetch(`${upstream}/__relay/hits?tag=${tag}`, { signal: AbortSignal.timeout(5_000) });
	assert.equal(hits.status, 200);
	assert.equal((await hits.json()).hits, expected, `${tag} upstream hits`);
}

async function grantRelay(api: ApiClient, virtualKeyID: string): Promise<void> {
	await api.json(`/api/governance/virtual-keys/${virtualKeyID}`, {
		method: 'PUT', body: { relay_grants: [{ relay_name: 'runtime-acceptance' }] },
	});
}

async function verifyKeyRotation(api: ApiClient, current: RuntimeApplicationKey, upstream: string): Promise<string> {
	const rotated = await api.json(`/api/control-plane/applications/${current.applicationID}/keys/${current.virtualKeyID}/rotate`, {
		method: 'POST',
	});
	assert.equal(rotated.virtual_key_id, current.virtualKeyID);
	assert.ok(typeof rotated.value === 'string' && rotated.value !== current.key, 'rotation must return a new key value');
	const key = String(rotated.value);
	await verifySearch(api, { key: current.key, tag: 'rotation-old', status: 401 });
	await verifyUpstreamHits(upstream, 'rotation-old', 0);
	await verifySearch(api, { key, tag: 'rotation-new', status: 200 });
	await verifyUpstreamHits(upstream, 'rotation-new', 1);
	return key;
}

async function verifyKeyExpiry(api: ApiClient, upstream: string): Promise<RuntimeApplicationKey> {
	const expiring = await applicationKey(api, 10_000);
	assert.ok(expiring.expiresAt && Number.isFinite(Date.parse(expiring.expiresAt)), 'key expiry must be returned');
	await grantRelay(api, expiring.virtualKeyID);
	await verifySearch(api, { key: expiring.key, tag: 'expiry-active', status: 200 });
	await verifyUpstreamHits(upstream, 'expiry-active', 1);
	await delay(Math.max(0, Date.parse(expiring.expiresAt) + 100 - Date.now()));
	await verifySearch(api, { key: expiring.key, tag: 'expiry-expired', status: 401 });
	await verifyUpstreamHits(upstream, 'expiry-expired', 0);
	return expiring;
}

async function verifyKeyRevocation(api: ApiClient, upstream: string): Promise<RuntimeApplicationKey> {
	const active = await applicationKey(api);
	await grantRelay(api, active.virtualKeyID);
	await verifySearch(api, { key: active.key, tag: 'revocation-active', status: 200 });
	await verifyUpstreamHits(upstream, 'revocation-active', 1);
	const revoked = await api.request(`/api/control-plane/applications/${active.applicationID}/keys/${active.virtualKeyID}`, {
		method: 'DELETE',
	});
	assert.equal(revoked.status, 204);
	await revoked.arrayBuffer();
	await verifySearch(api, { key: active.key, tag: 'revocation-revoked', status: 401 });
	await verifyUpstreamHits(upstream, 'revocation-revoked', 0);
	return active;
}

async function verifyCalls(api: ApiClient, credentials: {
	key: string; upstreamKey: string; auditMode: 'compact' | 'signed';
}): Promise<void> {
	const { key, upstreamKey, auditMode } = credentials;
	const headers = { 'x-bf-vk': key, 'X-Operation': 'search', 'User-Agent': 'codex-cli/relay-runtime-test' };
	for (const [suffix, status] of [['search', 200], ['free', 200], ['fail', 500]] as const) {
		const response = await api.request(`/relay/runtime-acceptance/v1/${suffix}`, { method: 'POST', body: '{}', headers });
		assert.equal(response.status, status, suffix);
		await response.arrayBuffer();
	}
	const stream = await api.request('/relay/runtime-acceptance/v1/stream', { method: 'POST', body: '{}', headers });
	assert.equal(stream.status, 200);
	assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
	const events = (await stream.text()).trim().split('\n\n').map(event => JSON.parse(event.slice(6)));
	assert.deepEqual(events.map(event => event.delta), ['a', 'b', 'c']);
	const echoResponse = await api.request('/relay/runtime-acceptance/v1/echo?q=kept', { headers });
	assert.equal(echoResponse.status, 200);
	const echo = await echoResponse.json();
	const forwarded = echo.headers as JsonRecord;
	assert.ok(forwarded.authorization === `Bearer ${upstreamKey}`, 'upstream credential did not survive the redacted PUT round trip');
	assert.deepEqual(echo.query, { q: 'kept' });
	assert.equal(forwarded.cookie, undefined, 'dashboard session must not reach upstream');
	assert.equal(forwarded['x-bf-vk'], undefined, 'gateway key must not reach upstream');
	if (auditMode === 'signed') {
		assert.ok(forwarded['x-recovery-secret'] === upstreamKey, 'encrypted extra header must survive restart and restore');
	}
}

async function verifyRouteDenials(api: ApiClient, key: string, upstream: string): Promise<void> {
	for (const [route, operation] of [['missing', 'search'], ['disabled', 'search'], ['search', 'unmatched']]) {
		const tag = `${route}-${operation}`;
		const response = await api.request(`/relay/runtime-acceptance/v1/${route}?tag=${tag}`, {
			method: 'POST', body: '{}', headers: { 'x-bf-vk': key, 'X-Operation': operation },
		});
		assert.equal(response.status, 404, tag);
		await response.arrayBuffer();
		await verifyUpstreamHits(upstream, tag, 0);
	}
}

async function verifyLogSummaries(api: ApiClient, query: string, logs: JsonRecord[]): Promise<void> {
	const cost = logs.reduce((sum, log) => sum + Number(log.cost ?? 0), 0);
	const stats = await api.json(`/api/relay-logs/stats?${query}`);
	assert.equal(stats.total_requests, logs.length);
	assert.ok(Math.abs(Number(stats.total_cost) - cost) < 1e-9);
	const histogram = await api.json(`/api/relay-logs/histogram?${query}&bucket_size_seconds=60`);
	const buckets = histogram.buckets as JsonRecord[];
	assert.equal(buckets.reduce((sum, bucket) => sum + Number(bucket.count), 0), logs.length);
	assert.ok(Math.abs(buckets.reduce((sum, bucket) => sum + Number(bucket.cost), 0) - cost) < 1e-9);
	const detail = await api.json(`/api/relay-logs/${logs[0].id}`);
	assert.equal(detail.id, logs[0].id);
}

async function verifyLogs(api: ApiClient): Promise<void> {
	const filters = { ...emptyRelayLogFilters(), relayNames: ['runtime-acceptance'] };
	const settling = relayLogParams(filters);
	settling.delete('end_time');
	const pagination = { limit: 100, offset: 0, sortBy: 'timestamp', order: 'asc' };
	let logs: JsonRecord[] = [];
	await waitFor(async () => {
		logs = relayLogPage(await api.json(relayLogListUrl(settling.toString(), pagination))).logs;
		return logs.some(log => log.path === '/v1/stream') && logs.some(log => log.path === '/v1/echo?q=kept');
	}, 'persisted relay log rows');
	// 等异步日志落地后冻结时间窗，避免把较晚记录永久排除在重试范围外。
	const query = relayLogParams(filters).toString();
	logs = relayLogPage(await api.json(relayLogListUrl(query, pagination))).logs;
	const successfulSearch = logs.find(log => log.path === '/v1/search' && log.status_code === 200);
	assert.ok(successfulSearch, 'successful search log missing');
	assert.ok(Math.abs(Number(successfulSearch.cost) - 0.041) < 1e-9);
	assert.equal(successfulSearch.input_tokens, 50);
	assert.equal(successfulSearch.output_tokens, 20);
	assert.equal(successfulSearch.app, 'Codex CLI');
	assert.equal(successfulSearch.user_agent, 'codex-cli/relay-runtime-test');
	for (const route of ['/v1/free', '/v1/fail']) {
		const entry = logs.find(log => log.path === route);
		assert.ok(entry);
		assert.equal(Number(entry.cost ?? 0), 0, `${route} must not be charged`);
	}
	const streamed = logs.find(log => log.path === '/v1/stream');
	assert.equal(streamed?.streamed, true);
	assert.ok(Math.abs(Number(streamed?.cost) - 0.031) < 1e-9);
	const exported = await collectRelayLogExport({
		target: logs.length, signal: new AbortController().signal, onProgress: () => {},
		fetchBatch: (offset, limit) => api.json(relayLogListUrl(query, { limit, offset, sortBy: 'timestamp', order: 'asc' })),
	});
	assert.equal(exported.length, logs.length);
	assert.ok(exported.every(log => !('request_body' in log) && !('request_headers' in log)));
	assert.match(relayLogsToCsv(exported), /"Codex CLI"/);
	await verifyLogSummaries(api, query, logs);
}

async function persistedState(api: ApiClient, keys: RuntimeApplicationKey[]): Promise<JsonRecord[]> {
	return Promise.all([
		api.json('/api/relays/runtime-acceptance'),
		api.json('/api/control-plane/projects'),
		api.json('/api/control-plane/audit-events?limit=100'),
		...keys.map(async key => {
			const saved = await api.json(`/api/control-plane/applications/${key.applicationID}/keys`);
			assert.ok(keyRows(saved).some(row => row.virtual_key_id === key.virtualKeyID),
				'issued key binding must remain in the administrator listing');
			return saved;
		}),
	]);
}

function keyRows(state: JsonRecord): JsonRecord[] {
	const rows = state.data;
	assert.ok(Array.isArray(rows));
	return rows.map(row => {
		assert.ok(row && typeof row === 'object' && !Array.isArray(row));
		return { ...(row as JsonRecord), revoked_at: (row as JsonRecord).revoked_at ?? null };
	});
}

function assertExpiredOnRestart(before: JsonRecord, after: JsonRecord): void {
	if (before.revoked_at !== null) {
		assert.deepEqual(after, before, 'previously revoked key metadata must not change');
		return;
	}
	const { revoked_at: beforeRevoked, updated_at: beforeUpdated, ...beforeMetadata } = before;
	const { revoked_at: afterRevoked, updated_at: afterUpdated, ...afterMetadata } = after;
	assert.equal(beforeRevoked, null);
	assert.ok(Date.parse(String(afterRevoked)) >= Date.parse(String(before.expires_at)),
		'startup must persist revocation after key expiry');
	assert.ok(Date.parse(String(afterUpdated)) >= Date.parse(String(beforeUpdated)));
	assert.deepEqual(afterMetadata, beforeMetadata, 'startup must retain all other expired-key metadata');
}

function assertRestartState(before: JsonRecord[], after: JsonRecord[], expiredKey: string): void {
	assert.equal(after.length, before.length);
	assert.deepEqual(after.slice(0, 3), before.slice(0, 3),
		'relay, project and audit state must survive full restart');
	for (let index = 3; index < before.length; index += 1) {
		const beforeKeys = keyRows(before[index]);
		const afterKeys = keyRows(after[index]);
		const beforeExpired = beforeKeys.find(row => row.virtual_key_id === expiredKey);
		if (beforeExpired) {
			const afterExpired = afterKeys.find(row => row.virtual_key_id === expiredKey);
			assert.ok(afterExpired);
			assert.equal(afterKeys.length, beforeKeys.length);
			assertExpiredOnRestart(beforeExpired, afterExpired);
		}
		assert.deepEqual(
			beforeKeys.filter(row => row.virtual_key_id !== expiredKey),
			afterKeys.filter(row => row.virtual_key_id !== expiredKey),
			'non-expired key metadata must survive full restart',
		);
	}
}

async function verifyRetainedKeys(api: ApiClient, upstream: string, keys: {
	active: string; rotated: string; expired: string; revoked: string; phase: string;
}): Promise<void> {
	for (const [name, key, status] of [
		['active', keys.active, 200], ['rotated', keys.rotated, 401],
		['expired', keys.expired, 401], ['revoked', keys.revoked, 401],
	] as const) {
		const tag = `${keys.phase}-${name}`;
		await verifySearch(api, { key, tag, status });
		await verifyUpstreamHits(upstream, tag, status === 200 ? 1 : 0);
	}
}

const postgresBin = process.env.ELYGATE_TEST_POSTGRES_BIN;
test.each(['compact', 'signed'] as const)(`panel contracts drive an isolated real gateway relay lifecycle (%s ${postgresBin ? 'PostgreSQL + restore' : 'SQLite'})`, async (auditMode) => {
	const binary = process.env.ELYGATE_TEST_BINARY;
	assert.ok(binary && path.isAbsolute(binary), 'ELYGATE_TEST_BINARY must name an absolute, freshly built gateway executable');
	const tempRoot = path.join(root, '.codex-tmp');
	await mkdir(tempRoot, { recursive: true });
	const workspace = await mkdtemp(path.join(tempRoot, 'relay-runtime-'));
	const appDir = path.join(workspace, 'app');
	await mkdir(appDir, { mode: 0o700 });
	const password = randomBytes(32).toString('base64url');
	const upstreamKey = randomBytes(32).toString('base64url');
	const pgPassword = randomBytes(32).toString('base64url');
	const encryptionKey = randomBytes(32).toString('base64url');
	const secrets = {
		ELYGATE_RELAY_TEST_PASSWORD: password, ELYGATE_RELAY_TEST_UPSTREAM_KEY: upstreamKey,
		ELYGATE_RELAY_TEST_PG_PASSWORD: pgPassword,
		...(auditMode === 'signed' ? { BIFROST_ENCRYPTION_KEY: encryptionKey } : {}),
	};
	let postgres: PrivatePostgres | undefined;
	const children: RuntimeChild[] = [];
	const failures: unknown[] = [];
	try {
		if (postgresBin !== undefined) postgres = new PrivatePostgres(postgresBin, workspace);
		await postgres?.initialize();
		await prepareConfig(appDir, postgres);
		await mkdir(path.join(appDir, 'private'), { mode: 0o700 });
		await writeFile(path.join(appDir, 'private', 'runtime-env.json'), JSON.stringify(secrets), { mode: 0o600 });
		const env = { PATH: process.env.PATH, HOME: appDir, TMPDIR: appDir };
		const fixturePort = await availablePort();
		const upstream = `http://127.0.0.1:${fixturePort}`;
		const fixture = trackedChild(process.execPath, ['tests/e2e/api/runners/relay-upstream-fixture.mjs'],
			{ cwd: root, env: { ...env, RELAY_UPSTREAM_FIXTURE_PORT: String(fixturePort) } });
		children.push(fixture);
		await waitForHTTP(`${upstream}/__relay/health`, fixture);
		const port = await availablePort();
		const origin = `http://127.0.0.1:${port}`;
		const startBackend = async () => {
			const recoveredSecrets = await runtimeSecrets(appDir);
			if (auditMode === 'signed') assert.ok(recoveredSecrets.BIFROST_ENCRYPTION_KEY,
				'signed runtime must load its encryption/signing material from the restored bundle');
			const runtime = trackedChild(binary, ['-app-dir', appDir, '-host', '127.0.0.1', '-port', String(port)], {
				cwd: root, env: { ...env, ELYGATE_APPLICATION_BINDING_MODE: 'required',
					...recoveredSecrets },
			});
			children.push(runtime);
			await waitForHTTP(`${origin}/health`, runtime);
			const health = await apiClient(origin).json('/health');
			assert.equal(health.status, 'ok');
			assert.equal((health.components as JsonRecord).db_pings, 'ok',
				'startup must verify configured storage, not just process liveness');
			await postgres?.verifyLiveStores(appDir);
			return runtime;
		};
		let backend = await startBackend();
		const api = apiClient(origin);
		const anonymous = await api.request('/api/relays');
		assert.equal(anonymous.status, 401);
		await anonymous.arrayBuffer();
		await api.json('/api/session/login', { method: 'POST', body: { username: 'relay-acceptance', password } });
		await verifyPreviewAndSave(api, upstream);
		if (auditMode === 'signed') await useLiteralRelayCredential(api, upstreamKey);
		const application = await applicationKey(api);
		const { key, virtualKeyID, applicationID } = application;
		await verifyDeniedGrant(api, key, upstream);
		await grantRelay(api, virtualKeyID);
		await verifyRouteDenials(api, key, upstream);
		await verifyCalls(api, { key, upstreamKey, auditMode });
		await verifyLogs(api);
		const rotatedKey = await verifyKeyRotation(api, application, upstream);
		const expiring = await verifyKeyExpiry(api, upstream);
		const revokedKey = await verifyKeyRevocation(api, upstream);
		if (auditMode === 'signed') await signedAuditSnapshot(api);
		if (postgres) {
			const allKeys = [application, expiring, revokedKey];
			const beforeRestart = await persistedState(api, allKeys);
			const auditBeforeRestart = auditMode === 'signed' ? await signedAuditSnapshot(api) : undefined;
			if (auditMode === 'signed') await verifyEncryptedStore(postgres, upstreamKey);
			await stopChild(backend);
			await postgres.restart();
			backend = await startBackend();
			assertRestartState(beforeRestart, await persistedState(api, allKeys), expiring.virtualKeyID);
			if (auditBeforeRestart) assert.deepEqual(await signedAuditSnapshot(api), auditBeforeRestart);
			await verifyLogs(api);
			await verifyRetainedKeys(api, upstream, {
				active: rotatedKey, rotated: key, expired: expiring.key, revoked: revokedKey.key, phase: 'restart',
			});
			console.log('PASS PostgreSQL and gateway restart: session, relay, grants, active/expired/revoked keys, logs, audit');
			const beforeRestore = await persistedState(api, allKeys);
			const secretBackup = await readFile(path.join(appDir, 'private', 'runtime-env.json'));
			const auditBeforeRestore = auditMode === 'signed' ? await signedAuditSnapshot(api) : undefined;
			await mkdir(path.join(appDir, 'uploads'), { mode: 0o700 });
			const uploadProbe = randomBytes(64);
			await writeFile(path.join(appDir, 'uploads', 'recovery-probe.bin'), uploadProbe, { mode: 0o600 });
			await stopChild(backend);
			await postgres.restoreBackup(appDir);
			assert.deepEqual(await readFile(path.join(appDir, 'uploads', 'recovery-probe.bin')), uploadProbe);
			assert.equal((await stat(path.join(appDir, 'uploads', 'recovery-probe.bin'))).mode & 0o777, 0o600);
			assert.ok((await readFile(path.join(appDir, 'private', 'runtime-env.json'))).equals(secretBackup),
				'recovery must restore the exact runtime secret bundle, not reuse in-memory credentials');
			backend = await startBackend();
			assert.deepEqual(await persistedState(api, allKeys), beforeRestore,
				'restored configuration, sessions, key metadata and audit must match the backup');
			if (auditBeforeRestore) {
				assert.deepEqual(await signedAuditSnapshot(api), auditBeforeRestore);
				await verifyEncryptedStore(postgres, upstreamKey);
			}
			await verifyRecoveredLogin(origin, appDir);
			await verifyLogs(api);
			await verifyCalls(api, { key: rotatedKey, upstreamKey, auditMode });
			await verifyRetainedKeys(api, upstream, {
				active: rotatedKey, rotated: key, expired: expiring.key, revoked: revokedKey.key, phase: 'restore',
			});
			const restoredNewKey = await applicationKey(api);
			await grantRelay(api, restoredNewKey.virtualKeyID);
			await verifySearch(api, { key: restoredNewKey.key, tag: 'restored-new-key', status: 200 });
			await verifyUpstreamHits(upstream, 'restored-new-key', 1);
			if (auditBeforeRestore) {
				const appended = await signedAuditSnapshot(api);
				assert.ok(Number(appended.chain.head_sequence) > Number(auditBeforeRestore.chain.head_sequence),
					'restored signing material must append to the original verified chain');
				assert.deepEqual(appended.publicKey, auditBeforeRestore.publicKey);
				await verifyEncryptedStore(postgres, upstreamKey);
				console.log('PASS encrypted recovery: private secret bundle, ciphertext, original signing key and chain continuation');
			}
			console.log('PASS restored gateway: file bytes, session, key policy, forwarding, logs/export and new writes');
		}
		const revoked = await api.request(`/api/control-plane/applications/${applicationID}/virtual-key-binding`, { method: 'DELETE' });
		assert.equal(revoked.status, 204);
		await revoked.arrayBuffer();
		await verifySearch(api, { key: rotatedKey, tag: 'binding-revoked', status: 401 });
		await verifyUpstreamHits(upstream, 'binding-revoked', 0);
		const removed = await api.request('/api/relays/runtime-acceptance', { method: 'DELETE' });
		assert.equal(removed.status, 204);
		await removed.arrayBuffer();
		const missing = await api.request('/api/relays/runtime-acceptance');
		assert.equal(missing.status, 404);
		await missing.arrayBuffer();
	} catch (cause) {
		failures.push(cause);
		for (const runtime of children) {
			console.error(runtime.output().replaceAll(password, '[REDACTED_SECRET]')
				.replaceAll(upstreamKey, '[REDACTED_SECRET]').replaceAll(pgPassword, '[REDACTED_SECRET]')
				.replaceAll(encryptionKey, '[REDACTED_SECRET]'));
		}
	} finally {
		const stopped = await Promise.allSettled(children.toReversed().map(stopChild));
		failures.push(...stopped.filter(status => status.status === 'rejected').map(status => status.reason));
		if (postgres) {
			try { await postgres.verifyCleanup(); } catch (cause) { failures.push(cause); }
			try { await postgres.stop(); } catch (cause) { failures.push(cause); }
		}
		const removed = await Promise.allSettled([rm(workspace, { recursive: true, force: true })]);
		failures.push(...removed.filter(status => status.status === 'rejected').map(status => status.reason));
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'relay acceptance or cleanup failed');
}, 900_000);
