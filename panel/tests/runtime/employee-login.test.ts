import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Database } from 'bun:sqlite';
import { test } from 'bun:test';
import { isJsonRecord, type JsonRecord } from '../../src/lib/api';
import { availablePort, trackedChild, stopChild, waitForHTTP, type RuntimeChild } from './process';
import { PrivatePostgres } from './postgres';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const loginPath = '/employee/api/session/login';
const auditPath = '/api/control-plane/audit-events?limit=100';
const failureAction = 'employee_session.login_failed';
const postgresBin = process.env.ELYGATE_TEST_POSTGRES_BIN;
const storeName = postgresBin === undefined ? 'SQLite' : 'PostgreSQL';
let forwardedSource = 0;

async function prepareConfig(appDir: string, postgres?: PrivatePostgres): Promise<void> {
	for (const [name, content] of Object.entries({ pricing: '{}', parameters: '{}', library: '{"servers":[]}' })) {
		await writeFile(path.join(appDir, `${name}.json`), content, { mode: 0o600 });
	}
	const catalogURL = (name: string) => pathToFileURL(path.join(appDir, `${name}.json`)).href;
	await writeFile(path.join(appDir, 'config.json'), JSON.stringify({
		...postgres?.stores(),
		client: { allowed_origins: [], log_retention_days: 0 }, providers: {},
		governance: { auth_config: { is_enabled: true, admin_username: 'employee-acceptance',
			admin_password: 'env.ELYGATE_EMPLOYEE_TEST_PASSWORD' } },
		framework: { pricing: { pricing_url: catalogURL('pricing'), model_parameters_url: catalogURL('parameters'),
			mcp_library_url: catalogURL('library') } },
		plugins: [{ name: 'logging', enabled: true, config: {} }, { name: 'governance', enabled: true, config: {} }],
	}), { mode: 0o600 });
}

function apiClient(origin: string) {
	let cookie = '';
	return {
		async request(route: string, options: {
			method?: string; body?: unknown; status?: number; headers?: Record<string, string>; anonymous?: boolean;
		} = {}) {
			const response = await fetch(origin + route, {
				method: options.method ?? 'GET', signal: AbortSignal.timeout(10_000),
				headers: { Origin: origin, 'Content-Type': 'application/json',
					...(!options.anonymous && cookie ? { Cookie: cookie } : {}), ...options.headers },
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
			});
			// Do not include request/response bodies in assertion diagnostics: they may contain credentials.
			assert.equal(response.status, options.status ?? 200, `${options.method ?? 'GET'} ${route}`);
			if (route === '/api/session/login') {
				const session = response.headers.getSetCookie();
				assert.equal(session.length, 1, 'administrator login must issue exactly one session cookie');
				cookie = session[0].split(';')[0];
			}
			const text = await response.text();
			const body: unknown = text ? JSON.parse(text) : null;
			return { response, body };
		},
		async json(route: string, options: Parameters<typeof this.request>[1] = {}): Promise<JsonRecord> {
			const { body } = await this.request(route, options);
			assert.ok(isJsonRecord(body), `${route} must return an object`);
			return body;
		},
	};
}

type ApiClient = ReturnType<typeof apiClient>;

async function failureFeed(api: ApiClient): Promise<JsonRecord[]> {
	const feed = await api.json(auditPath);
	assert.ok(Array.isArray(feed.data));
	const events = feed.data.filter((event): event is JsonRecord => isJsonRecord(event) && event.action === failureAction);
	for (const event of events) {
		assert.equal(event.actor_id, 'anonymous');
		assert.equal(event.resource_type, 'employee_session');
		assert.equal(event.resource_id, 'employee');
		assert.ok(!event.request_id && !event.trace_id, 'untrusted correlation must not enter rejected-login audit');
	}
	return events;
}

async function rejectLogin(api: ApiClient, username: string, password: string, status = 401, auditFailure = false) {
	const { response, body } = await api.request(loginPath, {
		method: 'POST', status,
		body: { username, password, employee_id: 'forged-employee-marker', auth_method: 'forged-method-marker' },
		headers: { 'X-Forwarded-For': `192.0.2.${(++forwardedSource % 200) + 1}`,
			'X-Real-IP': '198.51.100.9', 'X-Request-ID': 'forged-request-marker',
			traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01' },
	});
	assert.equal(response.headers.getSetCookie().length, 0, 'rejected login must not issue or clear a cookie');
	assert.equal(response.headers.get('x-elygate-audit-status'), auditFailure ? 'failed' : null);
	if (status === 401) assert.deepEqual(body, { error: '\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef' });
}

function withDatabase<T>(appDir: string, read: (db: Database) => T, readonly = true): T {
	const db = new Database(path.join(appDir, 'config.db'), { readonly, strict: true });
	try { return read(db); } finally { db.close(); }
}

async function storedRows(appDir: string, sql: string, postgres?: PrivatePostgres): Promise<JsonRecord[]> {
	const rows: unknown = postgres
		? JSON.parse(await postgres.queryConfig(`SELECT COALESCE(json_agg(row_to_json(snapshot)), '[]'::json)
			FROM (${sql}) AS snapshot`))
		: withDatabase(appDir, db => db.query(sql).all());
	assert.ok(Array.isArray(rows) && rows.every(isJsonRecord), 'stored verification query must return object rows');
	return rows;
}

async function verifyStored(appDir: string, signed: boolean, expectedAudits: number, failedLogins: number,
	locked: boolean, postgres?: PrivatePostgres) {
	const employees = await storedRows(appDir, 'SELECT failed_login_count, locked_until FROM elygate_employees', postgres);
	assert.equal(employees.length, 1);
	const [employee] = employees;
	assert.equal(employee.failed_login_count, failedLogins);
	assert.equal(employee.locked_until !== null, locked);
	if (locked) assert.ok(Date.parse(String(employee.locked_until)) > Date.now(), 'persisted lock must still be active');
	const [sessions] = await storedRows(appDir, 'SELECT count(*) AS count FROM elygate_employee_sessions', postgres);
	assert.equal(sessions.count, 0, 'rejected credentials must not create sessions');
	for (const table of ['elygate_control_audit_events', 'governance_audit_events']) {
		const rows = await storedRows(appDir, `SELECT * FROM ${table} WHERE action = '${failureAction}' ORDER BY id`, postgres);
		assert.equal(rows.length, (signed === (table === 'governance_audit_events')) ? expectedAudits : 0,
			'failure events must be stored once in the selected audit mode');
		for (const event of rows) {
			assert.equal(event.actor_id, 'anonymous');
			assert.equal(event.resource_id, 'employee');
			assert.ok(!event.request_id && !event.trace_id);
			if (signed) {
				assert.equal(event.auth_method, 'none');
				assert.equal(event.local_admin, postgres ? false : 0);
				assert.equal(event.outcome, 'denied');
				for (const field of ['before_json', 'after_json', 'metadata_json']) assert.equal(event[field], '{}');
				assert.ok(typeof event.signature === 'string' && event.signature.length > 0);
			}
		}
	}
}

async function auditFault(appDir: string, signed: boolean, enabled: boolean, postgres?: PrivatePostgres) {
	const table = signed ? 'governance_audit_events' : 'elygate_control_audit_events';
	if (postgres) {
		await postgres.queryConfig(enabled
			? `CREATE FUNCTION reject_runtime_login_audit() RETURNS trigger LANGUAGE plpgsql AS $$
				BEGIN IF NEW.action = '${failureAction}' THEN
					RAISE EXCEPTION 'runtime audit rejection';
				END IF; RETURN NEW; END $$;
				CREATE TRIGGER reject_runtime_login_audit BEFORE INSERT ON ${table}
					FOR EACH ROW EXECUTE FUNCTION reject_runtime_login_audit()`
			: `DROP TRIGGER reject_runtime_login_audit ON ${table}; DROP FUNCTION reject_runtime_login_audit()`);
		return;
	}
	withDatabase(appDir, db => db.exec(enabled
		? `CREATE TRIGGER reject_runtime_login_audit BEFORE INSERT ON ${table}
			WHEN NEW.action = '${failureAction}' BEGIN SELECT RAISE(ABORT, 'runtime audit rejection'); END`
		: 'DROP TRIGGER reject_runtime_login_audit'), false);
}

async function verifySignedChain(api: ApiClient, signed: boolean) {
	if (!signed) return;
	const result = await api.json('/api/governance/audit-logs/verify');
	assert.equal(result.valid, true);
	assert.ok(Number(result.head_sequence) > 0);
}

for (const signed of [false, true]) {
	test(`canonical employee login audit, admission and restart (${signed ? 'signed' : 'compact'} ${storeName})`, async () => {
		const binary = process.env.ELYGATE_TEST_BINARY;
		assert.ok(binary && path.isAbsolute(binary), 'ELYGATE_TEST_BINARY must name an absolute, freshly built gateway executable');
		const workspace = await mkdtemp(path.join(root, '.codex-tmp/employee-rt-'));
		const appDir = path.join(workspace, 'app');
		const password = randomBytes(32).toString('base64url');
		const encryptionKey = randomBytes(32).toString('base64url');
		const wrongPassword = randomBytes(32).toString('base64url');
		const pgPassword = randomBytes(32).toString('base64url');
		const failures: unknown[] = [];
		const children: RuntimeChild[] = [];
		let postgres: PrivatePostgres | undefined;
		try {
			await mkdir(appDir, { mode: 0o700 });
			if (postgresBin !== undefined) postgres = new PrivatePostgres(postgresBin, workspace);
			await postgres?.initialize();
			await prepareConfig(appDir, postgres);
			const port = await availablePort();
			const origin = `http://127.0.0.1:${port}`;
			const start = async () => {
				const child = trackedChild(binary, ['-app-dir', appDir, '-host', '127.0.0.1', '-port', String(port)], {
					cwd: root, env: { PATH: process.env.PATH, HOME: appDir, TMPDIR: appDir,
						ELYGATE_EMPLOYEE_TEST_PASSWORD: password, ELYGATE_RELAY_TEST_PG_PASSWORD: pgPassword,
						...(signed ? { BIFROST_ENCRYPTION_KEY: encryptionKey } : {}) },
				});
				children.push(child);
				await waitForHTTP(`${origin}/health`, child);
				const health = await apiClient(origin).json('/health', { anonymous: true });
				assert.equal(health.status, 'ok');
				assert.ok(isJsonRecord(health.components) && health.components.db_pings === 'ok',
					'startup must verify configured database health, not just process liveness');
				await postgres?.verifyLiveStores(appDir);
				return child;
			};
			let backend = await start();
			const api = apiClient(origin);
			await api.request(auditPath, { anonymous: true, status: 401 });
			await api.request('/api/employees', { anonymous: true, status: 401 });
			await api.json('/api/session/login', { method: 'POST', body: { username: 'employee-acceptance', password } });
			const key = await api.json('/api/governance/virtual-keys', {
				method: 'POST', body: { name: 'employee-runtime-only' },
			});
			assert.ok(isJsonRecord(key.virtual_key) && typeof key.virtual_key.id === 'string');
			const created = await api.json('/api/employees', { method: 'POST', body: {
				username: 'employee.runtime', name: 'Runtime Employee', virtual_key_ids: [key.virtual_key.id],
			} });
			assert.ok(isJsonRecord(created.employee) && typeof created.employee.id === 'string');
			assert.equal(typeof created.temporary_password, 'string');
			const temporaryPassword = created.temporary_password as string;
			const login = await api.request(loginPath, { method: 'POST', anonymous: true,
				body: { username: 'employee.runtime', password: temporaryPassword } });
			assert.ok(isJsonRecord(login.body) && typeof login.body.csrf_token === 'string');
			const employeeCookies = login.response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
			assert.ok(employeeCookies.includes('employee_token='));
			assert.ok(employeeCookies.includes('employee_csrf='));
			await api.request('/employee/api/session', { anonymous: true, headers: { Cookie: employeeCookies } });
			await api.request('/api/employees', { anonymous: true, headers: { Cookie: employeeCookies }, status: 401 });
			await api.request('/employee/api/session/logout', { method: 'POST', anonymous: true, status: 204,
				headers: { Cookie: employeeCookies, 'X-CSRF-Token': login.body.csrf_token } });
			assert.equal((await failureFeed(api)).length, 0);

			await rejectLogin(api, 'unknown-runtime-marker', wrongPassword);
			// The existing limiter counts the successful login above too: five total attempts.
			for (let index = 0; index < 3; index++) await rejectLogin(api, 'employee.runtime', wrongPassword);
			const initial = await failureFeed(api);
			assert.equal(initial.length, 4);
			for (const secret of [password, wrongPassword, temporaryPassword, encryptionKey, 'forged-', 'employee.runtime']) {
				assert.ok(!JSON.stringify(initial).includes(secret), 'failure feed must not expose credentials or claimed identity');
			}
			await Promise.all(Array.from({ length: 8 }, (_, index) => rejectLogin(api, `rotated-runtime-${index}`, wrongPassword, 429)));
			assert.deepEqual(await failureFeed(api), initial, 'source exhaustion must stop further audit writes');
			await verifyStored(appDir, signed, 4, 3, false, postgres);
			await verifySignedChain(api, signed);
			await stopChild(backend);

			// Only the fresh private store receives fault injection, with the gateway stopped.
			await auditFault(appDir, signed, true, postgres);
			await postgres?.restart();
			backend = await start();
			assert.deepEqual(await failureFeed(api), initial, 'administrator session and audit survive a normal restart');
			await verifyStored(appDir, signed, 4, 3, false, postgres);
			await rejectLogin(api, 'employee.runtime', wrongPassword, 401, true);
			await verifyStored(appDir, signed, 4, 4, false, postgres);
			await rejectLogin(api, 'employee.runtime', wrongPassword, 401, true);
			await rejectLogin(api, 'employee.runtime', temporaryPassword, 429);
			assert.deepEqual(await failureFeed(api), initial, 'failed audit transaction must not leave an event');
			await verifyStored(appDir, signed, 4, 0, true, postgres);
			await verifySignedChain(api, signed);
			await stopChild(backend);

			await auditFault(appDir, signed, false, postgres);
			await postgres?.restart();
			backend = await start();
			assert.deepEqual(await failureFeed(api), initial);
			await verifyStored(appDir, signed, 4, 0, true, postgres);
			await rejectLogin(api, 'employee.runtime', temporaryPassword, 429);
			await rejectLogin(api, 'unknown-after-restart-marker', wrongPassword);
			assert.equal((await failureFeed(api)).length, 5, 'audit writing must recover after fixture fault removal');
			await verifyStored(appDir, signed, 5, 0, true, postgres);
			await verifySignedChain(api, signed);
			await api.request(auditPath, { anonymous: true, status: 401 });
			console.log(`PASS employee ${signed ? 'signed' : 'compact'} ${storeName}: network routes, source admission, audit fault and restart`);
		} catch (cause) {
			failures.push(cause);
		} finally {
			for (const child of children.reverse()) {
				if (child.child.exitCode === 0 && child.child.signalCode === null) continue;
				try { await stopChild(child); } catch (cause) { failures.push(cause); }
			}
			if (postgres) {
				try { await postgres.verifyCleanup(); } catch (cause) { failures.push(cause); }
				try { await postgres.stop(); } catch (cause) { failures.push(cause); }
			}
			try {
				await rm(workspace, { recursive: true, force: true });
				await assert.rejects(stat(workspace), { code: 'ENOENT' });
			} catch (cause) { failures.push(cause); }
		}
		if (failures.length) throw new AggregateError(failures, 'isolated employee runtime acceptance failed');
	}, 300_000);
}
