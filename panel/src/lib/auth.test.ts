import { afterEach, describe, expect, test } from 'bun:test';
import { createBifrostAuthProvider } from './auth';

const originalFetch = globalThis.fetch;
let authenticatedCallbacks = 0;
const auth = createBifrostAuthProvider(() => 'zh-CN', async () => { authenticatedCallbacks += 1; });

function respond(payload: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => { globalThis.fetch = originalFetch; authenticatedCallbacks = 0; });

describe('Bifrost AuthProvider', () => {
	test('fails closed when server authentication is disabled', async () => {
		globalThis.fetch = (() => respond({ auth_type: 'none', has_valid_token: false, is_auth_enabled: false })) as typeof fetch;
		const result = await auth.check();
		expect(result.authenticated).toBe(false);
		expect(result.redirectTo).toBe('/login');
	});

	test('accepts only an enabled server session with a valid cookie', async () => {
		globalThis.fetch = (() => respond({ auth_type: 'password', has_valid_token: true, is_auth_enabled: true })) as typeof fetch;
		expect((await auth.check()).authenticated).toBe(true);
	});

	test('login uses same-origin cookies without client token persistence', async () => {
		let credentials: RequestCredentials | undefined;
		let body = '';
		globalThis.fetch = ((_input, init) => { credentials = init?.credentials; body = String(init?.body); return respond({ message: 'ok' }); }) as typeof fetch;
		const result = await auth.login({ username: 'admin', password: 'secret' });
		expect(result.success).toBe(true);
		expect(credentials).toBe('same-origin');
		expect(JSON.parse(body)).toEqual({ username: 'admin', password: 'secret' });
		expect(authenticatedCallbacks).toBe(1);
	});

	test('localizes invalid credentials without leaking the server language', async () => {
		globalThis.fetch = (() => respond({ error: 'Invalid username or password' }, 401)) as typeof fetch;
		const zh = await createBifrostAuthProvider(() => 'zh-CN', async () => {}).login({ username: 'admin', password: 'wrong' });
		const en = await createBifrostAuthProvider(() => 'en', async () => {}).login({ username: 'admin', password: 'wrong' });
		expect(zh.error?.message).toBe('用户名或密码错误');
		expect(en.error?.message).toBe('Invalid username or password');
	});
});
