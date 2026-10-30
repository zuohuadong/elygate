import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'bun:test';
import { isJsonRecord } from '../../src/lib/api';
import { buildRoutingDraftPayload, parseRoutingDraft, parseRoutingDraftPage, ROUTING_DRAFT_PATH, type RoutingDraft, type RoutingDraftSummary } from '../../src/lib/routing-drafts';
import { PrivatePostgres } from './postgres';
import { availablePort, trackedChild, stopChild, waitForHTTP, type RuntimeChild } from './process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const activeRule = {
	id: 'runtime-active-rule', name: 'Active route', enabled: true, chain_rule: false,
	scope: 'global', priority: 0, cel_expression: 'model == "input"',
	targets: [{ provider: 'openai', model: 'active-target', weight: 1 }],
};
const candidateRules = [{
	...activeRule, id: 'runtime-candidate', name: 'Candidate route',
	targets: [{ provider: 'openai', model: 'candidate-target', weight: 1, key_id: 'candidate-key', ttft_timeout_ms: 1234 }],
	fallbacks: ['azure/', { provider: 'openai', model: 'backup', key_id: 'backup-key' }],
}];
const candidateEditor = {
	rules: JSON.stringify(candidateRules), chainMaxDepth: 10,
	samples: 'sensitive sample that must not be persisted',
};

async function prepareConfig(appDir: string, postgres?: PrivatePostgres): Promise<void> {
	for (const [filename, content] of Object.entries({ pricing: '{}', parameters: '{}', library: '{"servers":[]}' })) {
		await writeFile(path.join(appDir, `${filename}.json`), content, { mode: 0o600 });
	}
	const catalogURL = (filename: string) => pathToFileURL(path.join(appDir, `${filename}.json`)).href;
	await writeFile(path.join(appDir, 'config.json'), JSON.stringify({
		...postgres?.stores(), client: { allowed_origins: [], log_retention_days: 0 }, providers: {},
		governance: { auth_config: { is_enabled: true, admin_username: 'draft-acceptance',
			admin_password: 'env.ELYGATE_DRAFT_TEST_PASSWORD' }, routing_rules: [activeRule] },
		framework: { pricing: { pricing_url: catalogURL('pricing'), model_parameters_url: catalogURL('parameters'),
			mcp_library_url: catalogURL('library') } },
		plugins: [{ name: 'logging', enabled: true, config: {} }, { name: 'governance', enabled: true, config: {} }],
	}), { mode: 0o600 });
}

function draftClient(origin: string) {
	let cookie = '';
	return async (route: string, options: { method?: string; body?: unknown; status?: number; headers?: Record<string, string> } = {}) => {
		const response = await fetch(origin + route, {
			method: options.method ?? 'GET', signal: AbortSignal.timeout(10_000),
			headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		assert.equal(response.status, options.status ?? 200, `${options.method ?? 'GET'} ${route}`);
		const session = response.headers.get('set-cookie');
		if (session) cookie = session.split(';')[0];
		if (route.startsWith(ROUTING_DRAFT_PATH)) assert.equal(response.headers.get('cache-control'), 'no-store');
		if (response.status === 204) {
			assert.equal(await response.text(), '');
			return null;
		}
		return response.json() as Promise<unknown>;
	};
}

type DraftClient = ReturnType<typeof draftClient>;

function canonicalTimestamps(draft: RoutingDraftSummary) {
	// PostgreSQL may return a different offset; compare instants without losing fractional precision.
	const instant = (timestamp: string) => ({
		milliseconds: Date.parse(timestamp),
		fraction: (timestamp.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0'),
	});
	return { ...draft, created_at: instant(draft.created_at), updated_at: instant(draft.updated_at) };
}

async function draftAudit(api: DraftClient): Promise<unknown[]> {
	const feed = await api('/api/control-plane/audit-events?limit=100');
	assert.ok(isJsonRecord(feed) && Array.isArray(feed.data));
	return feed.data.filter(event => isJsonRecord(event) && event.resource_type === 'routing-draft');
}

async function verifyCreation(api: DraftClient): Promise<RoutingDraft> {
	assert.deepEqual(parseRoutingDraftPage(await api(`${ROUTING_DRAFT_PATH}?limit=25&offset=0`), 0), []);
	const payload = buildRoutingDraftPayload('  Candidate  ', candidateEditor);
	assert.deepEqual(Object.keys(payload).sort(), ['chain_max_depth', 'name', 'rules']);
	const created = parseRoutingDraft(await api(ROUTING_DRAFT_PATH, { method: 'POST', body: payload, status: 201 }));
	assert.equal(created.name, 'Candidate');
	assert.equal(created.revision, 1);
	assert.equal(created.chain_max_depth, 10);
	assert.deepEqual(created.rules, candidateRules);
	assert.deepEqual(canonicalTimestamps(parseRoutingDraft(await api(`${ROUTING_DRAFT_PATH}/${created.id}`), created.id)), canonicalTimestamps(created));
	const summaries = parseRoutingDraftPage(await api(`${ROUTING_DRAFT_PATH}?limit=25&offset=0`), 0);
	const { rules: _rules, ...summary } = created;
	assert.deepEqual(summaries.map(canonicalTimestamps), [canonicalTimestamps(summary)]);
	assert.deepEqual(parseRoutingDraftPage(await api(`${ROUTING_DRAFT_PATH}?limit=25&offset=25`), 25), []);
	return created;
}

async function verifyRejections(api: DraftClient, created: RoutingDraft): Promise<void> {
	const before = await draftAudit(api);
	const payload = buildRoutingDraftPayload('Rejected', candidateEditor);
	for (const body of [
		{ ...payload, samples: [candidateEditor.samples] },
		{ ...payload, rules: [{ ...candidateRules[0], cel_expression: 'model ==' }] },
		{ ...payload, rules: [{ ...candidateRules[0], fallbacks: [{ provider: 'openai', model: 'backup', unknown: true }] }] },
	]) await api(ROUTING_DRAFT_PATH, { method: 'POST', body, status: 400 });
	await api(ROUTING_DRAFT_PATH, { method: 'POST', body: payload, status: 403, headers: { Origin: 'https://foreign.invalid' } });
	await api(ROUTING_DRAFT_PATH, { method: 'POST', body: payload, status: 415, headers: { 'Content-Type': 'text/plain' } });
	await api(`${ROUTING_DRAFT_PATH}/${created.id}`, { method: 'PUT', body: { ...payload, expected_revision: 0 }, status: 400 });
	assert.deepEqual(await draftAudit(api), before, 'rejected writes must not create audit events');
	assert.deepEqual(canonicalTimestamps(parseRoutingDraft(await api(`${ROUTING_DRAFT_PATH}/${created.id}`), created.id)), canonicalTimestamps(created));
	assert.equal(parseRoutingDraftPage(await api(`${ROUTING_DRAFT_PATH}?limit=25&offset=0`), 0).length, 1);
}

async function verifyConcurrentRevision(api: DraftClient, created: RoutingDraft): Promise<RoutingDraft> {
	const route = `${ROUTING_DRAFT_PATH}/${created.id}`;
	const before = await draftAudit(api);
	// Revision boundaries: one current writer wins; stale update and delete must preserve it.
	const competing = ['Writer A', 'Writer B'].map(name => buildRoutingDraftPayload(name, candidateEditor, created.revision));
	const results = await Promise.allSettled(competing.map(body => api(route, { method: 'PUT', body })));
	assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
	const rejected = results.filter(result => result.status === 'rejected');
	assert.equal(rejected.length, 1);
	assert.ok(rejected[0].reason instanceof assert.AssertionError);
	assert.equal(rejected[0].reason.actual, 409);
	assert.equal(rejected[0].reason.expected, 200);
	const saved = parseRoutingDraft(await api(route), created.id);
	assert.equal(saved.revision, 2);
	assert.ok(['Writer A', 'Writer B'].includes(saved.name));
	await api(route, { method: 'DELETE', body: { expected_revision: 1 }, status: 409 });
	assert.deepEqual(canonicalTimestamps(parseRoutingDraft(await api(route), created.id)), canonicalTimestamps(saved));
	assert.equal((await draftAudit(api)).length, before.length + 1, 'only the winning update is audited');
	return saved;
}

async function verifyDeletion(api: DraftClient, saved: RoutingDraft): Promise<void> {
	const route = `${ROUTING_DRAFT_PATH}/${saved.id}`;
	const before = await draftAudit(api);
	await api(route, { method: 'DELETE', body: { expected_revision: saved.revision }, status: 204 });
	await api(route, { status: 404 });
	await api(route, { method: 'DELETE', body: { expected_revision: saved.revision }, status: 404 });
	assert.deepEqual(parseRoutingDraftPage(await api(`${ROUTING_DRAFT_PATH}?limit=25&offset=0`), 0), []);
	const events = await draftAudit(api);
	assert.equal(events.length, before.length + 1);
	assert.ok(events.every(event => isJsonRecord(event) && event.resource_id === saved.id && event.actor_id));
	assert.deepEqual(events.map(event => (event as { action: string }).action).sort(),
		['routing-draft.create', 'routing-draft.delete', 'routing-draft.update']);
}

const postgresBin = process.env.ELYGATE_TEST_POSTGRES_BIN;
test(`panel draft contracts drive the canonical gateway (${postgresBin ? 'PostgreSQL' : 'SQLite'})`, async () => {
	const binary = process.env.ELYGATE_TEST_BINARY;
	assert.ok(binary && path.isAbsolute(binary), 'ELYGATE_TEST_BINARY must name an absolute, freshly built gateway executable');
	await mkdir(path.join(root, '.codex-tmp'), { recursive: true });
	const workspace = await mkdtemp(path.join(root, '.codex-tmp/draft-rt-'));
	const appDir = path.join(workspace, 'app');
	await mkdir(appDir, { mode: 0o700 });
	const password = randomBytes(32).toString('base64url');
	const pgPassword = randomBytes(32).toString('base64url');
	const children: RuntimeChild[] = [];
	const failures: unknown[] = [];
	let postgres: PrivatePostgres | undefined;
	try {
		if (postgresBin !== undefined) postgres = new PrivatePostgres(postgresBin, workspace);
		await postgres?.initialize();
		await prepareConfig(appDir, postgres);
		const port = await availablePort();
		const origin = `http://127.0.0.1:${port}`;
		const startBackend = async () => {
			const runtime = trackedChild(binary, ['-app-dir', appDir, '-host', '127.0.0.1', '-port', String(port)], {
				cwd: root, env: { PATH: process.env.PATH, HOME: appDir, TMPDIR: appDir,
					ELYGATE_DRAFT_TEST_PASSWORD: password, ELYGATE_RELAY_TEST_PG_PASSWORD: pgPassword },
			});
			children.push(runtime);
			await waitForHTTP(`${origin}/health`, runtime);
			await postgres?.verifyLiveStores(appDir);
			return runtime;
		};
		let backend = await startBackend();
		const api = draftClient(origin);
		await api(ROUTING_DRAFT_PATH, { status: 401 });
		await api('/api/session/login', { method: 'POST', body: { username: 'draft-acceptance', password } });
		const activeBefore = await api('/api/routing/rules');
		const created = await verifyCreation(api);
		await verifyRejections(api, created);
		const saved = await verifyConcurrentRevision(api, created);
		assert.deepEqual(await api('/api/routing/rules'), activeBefore, 'draft edits must never publish a rule');
		const auditBefore = await draftAudit(api);
		await stopChild(backend);
		await postgres?.restart();
		backend = await startBackend();
		assert.deepEqual(canonicalTimestamps(parseRoutingDraft(await api(`${ROUTING_DRAFT_PATH}/${saved.id}`), saved.id)), canonicalTimestamps(saved),
			'full draft and administrator session must survive gateway/database restart');
		assert.deepEqual(await draftAudit(api), auditBefore);
		assert.deepEqual(await api('/api/routing/rules'), activeBefore);
		await verifyDeletion(api, saved);
		await stopChild(backend);
		await startBackend();
		await api(`${ROUTING_DRAFT_PATH}/${saved.id}`, { status: 404 });
		assert.deepEqual(await api('/api/routing/rules'), activeBefore);
		console.log('PASS real draft CRUD, validation, competing revisions, audit, restart, deletion persistence and active-rule isolation');
	} catch (cause) {
		failures.push(cause);
		for (const runtime of children) console.error(runtime.output()
			.replaceAll(password, '[REDACTED_SECRET]').replaceAll(pgPassword, '[REDACTED_SECRET]'));
	} finally {
		const stopped = await Promise.allSettled(children.toReversed().map(stopChild));
		failures.push(...stopped.filter(status => status.status === 'rejected').map(status => status.reason));
		if (postgres) {
			try { await postgres.verifyCleanup(); } catch (cause) { failures.push(cause); }
			try { await postgres.stop(); } catch (cause) { failures.push(cause); }
		}
		try { await rm(workspace, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
	}
	if (failures.length) throw new AggregateError(failures, 'routing draft runtime acceptance or cleanup failed');
}, 900_000);
