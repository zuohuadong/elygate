import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'bun:test';
import { buildRelayPayload, emptyRelayDraft, relayDraftFromConfig, relayLogParams, emptyRelayLogFilters } from '../../src/lib/relay-management';
import { relayRulesFromJson, relayRulesToJson } from '../../src/lib/relay-rules';
import { collectRelayLogExport, relayLogListUrl, relayLogPage, relayLogsToCsv } from '../../src/lib/relay-log-export';
import type { JsonRecord } from '../../src/lib/api';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function availablePort(): Promise<number> {
	const listener = createServer();
	listener.listen(0, '127.0.0.1');
	await once(listener, 'listening');
	const port = (listener.address() as AddressInfo).port;
	await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
	return port;
}

function trackedChild(command: string, args: string[], env: NodeJS.ProcessEnv) {
	const child = spawn(command, args, { cwd: root, env, stdio: 'pipe' });
	let output = '';
	let failure: Error | undefined;
	child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-16_384); });
	child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(-16_384); });
	const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		child.once('error', error => { failure = error; resolve({ code: null, signal: null }); });
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	child.stdin.end();
	return { child, exit, output: () => output, failure: () => failure };
}

type RuntimeChild = ReturnType<typeof trackedChild>;

async function stopChild(runtime: RuntimeChild): Promise<void> {
	if (runtime.child.exitCode === null && runtime.child.signalCode === null) runtime.child.kill('SIGTERM');
	const status = await Promise.race([runtime.exit, delay(40_000, null, { ref: false })]);
	if (status === null) {
		runtime.child.kill('SIGKILL');
		await runtime.exit;
		throw new Error('isolated runtime did not stop gracefully within 40 seconds');
	}
	assert.ifError(runtime.failure());
	assert.deepEqual(status, { code: 0, signal: null }, 'isolated runtime exited unsuccessfully');
}

async function waitFor(probe: () => Promise<boolean>, description: string): Promise<void> {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (await probe()) return;
		await delay(250);
	}
	throw new Error(`timed out waiting for ${description}`);
}

async function waitForHTTP(url: string, runtime: RuntimeChild): Promise<void> {
	await waitFor(async () => {
		assert.ifError(runtime.failure());
		assert.equal(runtime.child.exitCode, null, 'runtime exited during startup');
		assert.equal(runtime.child.signalCode, null, 'runtime was killed during startup');
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			await response.arrayBuffer();
			return response.status === 200;
		} catch (cause) {
			const code = (cause as { cause?: { code?: string }; code?: string }).cause?.code
				?? (cause as { code?: string }).code;
			if (code === 'ECONNREFUSED' || code === 'ConnectionRefused') return false;
			throw cause;
		}
	}, url);
}

async function prepareConfig(appDir: string): Promise<void> {
	for (const [name, content] of Object.entries({ pricing: '{}', parameters: '{}', library: '{"servers":[]}' })) {
		await writeFile(path.join(appDir, `${name}.json`), content, { mode: 0o600 });
	}
	const catalogURL = (name: string) => pathToFileURL(path.join(appDir, `${name}.json`)).href;
	await writeFile(path.join(appDir, 'config.json'), JSON.stringify({
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

async function applicationKey(api: ApiClient): Promise<{ applicationID: string; key: string; virtualKeyID: string }> {
	const project = await api.json('/api/control-plane/projects', { method: 'POST', body: { name: 'Relay acceptance' }, status: 201 });
	const application = await api.json(`/api/control-plane/projects/${project.id}/applications`, {
		method: 'POST', body: { name: 'Relay runtime' }, status: 201,
	});
	const key = await api.json(`/api/control-plane/applications/${application.id}/keys`, {
		method: 'POST', body: { name: 'Relay runtime key' }, status: 201,
	});
	assert.equal(typeof key.value, 'string');
	assert.equal(typeof key.virtual_key_id, 'string');
	return { applicationID: String(application.id), key: String(key.value), virtualKeyID: String(key.virtual_key_id) };
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
	const headers = { 'x-bf-vk': key, 'X-Operation': 'search', 'User-Agent': 'codex-cli/relay-runtime-test' };
	// 未授权请求必须在触达上游前被拦截，而不只是返回一个错误状态。
	const denied = await api.request('/relay/runtime-acceptance/v1/search?tag=no-grant', { method: 'POST', body: '{}', headers });
	assert.equal(denied.status, 403);
	await denied.arrayBuffer();
	assert.equal((await (await fetch(`${upstream}/__relay/hits?tag=no-grant`)).json()).hits, 0);
}

async function verifyCalls(api: ApiClient, key: string, upstreamKey: string): Promise<void> {
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
}

async function verifyRouteDenials(api: ApiClient, key: string, upstream: string): Promise<void> {
	for (const [route, operation] of [['missing', 'search'], ['disabled', 'search'], ['search', 'unmatched']]) {
		const tag = `${route}-${operation}`;
		const response = await api.request(`/relay/runtime-acceptance/v1/${route}?tag=${tag}`, {
			method: 'POST', body: '{}', headers: { 'x-bf-vk': key, 'X-Operation': operation },
		});
		assert.equal(response.status, 404, tag);
		await response.arrayBuffer();
		const hits = await fetch(`${upstream}/__relay/hits?tag=${tag}`, { signal: AbortSignal.timeout(5_000) });
		assert.equal(hits.status, 200);
		assert.equal((await hits.json()).hits, 0, `${tag} reached upstream`);
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
		return logs.some(log => log.path === '/v1/stream') && logs.some(log => log.path === '/v1/echo');
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

test('panel contracts drive an isolated real gateway relay lifecycle', async () => {
	const binary = process.env.ELYGATE_TEST_BINARY;
	assert.ok(binary && path.isAbsolute(binary), 'ELYGATE_TEST_BINARY must name an absolute, freshly built gateway executable');
	const tempRoot = path.join(root, '.codex-tmp');
	await mkdir(tempRoot, { recursive: true });
	const appDir = await mkdtemp(path.join(tempRoot, 'relay-runtime-'));
	const password = randomBytes(32).toString('base64url');
	const upstreamKey = randomBytes(32).toString('base64url');
	const children: RuntimeChild[] = [];
	const failures: unknown[] = [];
	try {
		await prepareConfig(appDir);
		const env = { PATH: process.env.PATH, HOME: appDir, TMPDIR: appDir };
		const fixturePort = await availablePort();
		const upstream = `http://127.0.0.1:${fixturePort}`;
		const fixture = trackedChild(process.execPath, ['tests/e2e/api/runners/relay-upstream-fixture.mjs'],
			{ ...env, RELAY_UPSTREAM_FIXTURE_PORT: String(fixturePort) });
		children.push(fixture);
		await waitForHTTP(`${upstream}/__relay/health`, fixture);
		const port = await availablePort();
		const backend = trackedChild(binary, ['-app-dir', appDir, '-host', '127.0.0.1', '-port', String(port)],
			{ ...env, ELYGATE_APPLICATION_BINDING_MODE: 'required',
				ELYGATE_RELAY_TEST_PASSWORD: password, ELYGATE_RELAY_TEST_UPSTREAM_KEY: upstreamKey });
		children.push(backend);
		const origin = `http://127.0.0.1:${port}`;
		await waitForHTTP(`${origin}/health`, backend);
		const api = apiClient(origin);
		const anonymous = await api.request('/api/relays');
		assert.equal(anonymous.status, 401);
		await anonymous.arrayBuffer();
		await api.json('/api/session/login', { method: 'POST', body: { username: 'relay-acceptance', password } });
		await verifyPreviewAndSave(api, upstream);
		const { key, virtualKeyID, applicationID } = await applicationKey(api);
		await verifyDeniedGrant(api, key, upstream);
		await api.json(`/api/governance/virtual-keys/${virtualKeyID}`, {
			method: 'PUT', body: { relay_grants: [{ relay_name: 'runtime-acceptance' }] },
		});
		await verifyRouteDenials(api, key, upstream);
		await verifyCalls(api, key, upstreamKey);
		await verifyLogs(api);
		const revoked = await api.request(`/api/control-plane/applications/${applicationID}/virtual-key-binding`, { method: 'DELETE' });
		assert.equal(revoked.status, 204);
		await revoked.arrayBuffer();
		const refused = await api.request('/relay/runtime-acceptance/v1/search', { method: 'POST', body: '{}', headers: { 'x-bf-vk': key } });
		assert.equal(refused.status, 401, 'revoking the application binding must revoke relay access immediately');
		await refused.arrayBuffer();
		const removed = await api.request('/api/relays/runtime-acceptance', { method: 'DELETE' });
		assert.equal(removed.status, 204);
		await removed.arrayBuffer();
		const missing = await api.request('/api/relays/runtime-acceptance');
		assert.equal(missing.status, 404);
		await missing.arrayBuffer();
	} catch (cause) {
		failures.push(cause);
		for (const runtime of children) {
			console.error(runtime.output().replaceAll(password, '[REDACTED_SECRET]').replaceAll(upstreamKey, '[REDACTED_SECRET]'));
		}
	} finally {
		const stopped = await Promise.allSettled(children.toReversed().map(stopChild));
		failures.push(...stopped.filter(status => status.status === 'rejected').map(status => status.reason));
		const removed = await Promise.allSettled([rm(appDir, { recursive: true, force: true })]);
		failures.push(...removed.filter(status => status.status === 'rejected').map(status => status.reason));
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'relay acceptance or cleanup failed');
}, 330_000);
