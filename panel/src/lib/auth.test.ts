import { afterEach, describe, expect, test } from 'bun:test';
import { createBifrostAuthProvider } from './auth';

const originalFetch = globalThis.fetch;
const auth = createBifrostAuthProvider(() => 'zh-CN');

function respond(payload: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => { globalThis.fetch = originalFetch; });

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
	});
});
