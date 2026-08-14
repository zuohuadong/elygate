import { describe, expect, test } from 'bun:test';
import { BifrostEmployeeClient } from '../src/bifrost-client.ts';
import type { FetchLike } from '../src/http.ts';
import type { EmployeeIdentity } from '../src/types.ts';

const identity: EmployeeIdentity = {
  providerId: 'supauth',
  userId: 'user-1',
  email: 'employee@example.com',
  name: 'Employee',
  roles: ['employee'],
};

function mockFetch(responses: unknown[], calls: string[]): FetchLike {
  return (async (input: string | URL | Request) => {
    calls.push(String(input));
    const body = responses.shift();
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('Bifrost employee boundary', () => {
  test('redacts key values returned by the management API', async () => {
    const calls: string[] = [];
    const client = new BifrostEmployeeClient(new URL('http://elygate:8080'), 'token', mockFetch([
      { virtual_keys: [{ id: 'vk-1', name: 'mine', value: 'sk-bf-super-secret-value', is_active: true }] },
    ], calls));
    const keys = await client.keysFor(identity);
    expect(keys[0]?.maskedValue).toBe('sk-bf-su••••alue');
    expect(JSON.stringify(keys)).not.toContain('super-secret-value');
    expect(calls[0]).toContain('/api/users/email/employee%40example.com/virtual-keys');
  });

  test('uses the employee-scoped atomic endpoint when rotating a key', async () => {
    const calls: string[] = [];
    const client = new BifrostEmployeeClient(new URL('http://elygate:8080'), 'token', mockFetch([
      { virtual_key: { id: 'vk-owned', name: 'mine', value: 'sk-bf-new-value-1234' } },
    ], calls));
    await client.rotate(identity, 'vk-owned');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/users/email/employee%40example.com/virtual-keys/vk-owned/rotate');
  });

  test('rejects a rotate response for a different key', async () => {
    const calls: string[] = [];
    const client = new BifrostEmployeeClient(new URL('http://elygate:8080'), 'token', mockFetch([
      { virtual_key: { id: 'vk-other', value: 'sk-bf-new-value-1234' } },
    ], calls));
    await expect(client.rotate(identity, 'vk-owned')).rejects.toMatchObject({ status: 502 });
  });

  test('scopes dashboard usage to keys resolved for the current employee', async () => {
    const calls: string[] = [];
    const client = new BifrostEmployeeClient(new URL('http://elygate:8080'), 'token', mockFetch([
      { user_id: 'bifrost-user-1', virtual_keys: [{ id: 'vk-1' }, { id: 'vk-2' }] },
      { overview: { stats: { total_requests: 9 } } },
    ], calls));
    const usage = await client.usageFor(identity, '7d');
    expect(usage.keyIds).toEqual(['vk-1', 'vk-2']);
    expect(calls[1]).toContain('virtual_key_ids=vk-1%2Cvk-2');
    expect(calls[1]).toContain('user_ids=bifrost-user-1');
    await expect(client.usageFor(identity, '365d')).rejects.toMatchObject({ status: 400 });
  });

  test('fails closed when usage mapping has no Bifrost user ID', async () => {
    const client = new BifrostEmployeeClient(new URL('http://elygate:8080'), 'token', mockFetch([
      { virtual_keys: [{ id: 'vk-1' }] },
    ], []));
    await expect(client.usageFor(identity, '7d')).rejects.toMatchObject({ status: 502 });
  });
});
