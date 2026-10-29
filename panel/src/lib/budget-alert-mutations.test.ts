import { afterEach, describe, expect, test } from 'bun:test';
import { saveBudgetAcknowledgement, saveBudgetResolution, waitForBudgetAlertMutations } from './budget-alert-mutations';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const alert = {
	id: 'alert/1', scope_type: 'project', scope_id: 'p1', window: 'daily',
	period_start: '2026-10-27T00:00:00Z', threshold: .8, usage: 8, limit: 10,
	triggered_at: '2026-10-27T12:00:00Z', acknowledged: true,
	acknowledged_at: '2026-10-27T12:01:00Z', acknowledged_by: 'local-admin',
	resolved: false, resolved_at: null, resolved_by: null,
};

describe('budget acknowledgement lifetime', () => {
	test('fresh reads wait for a write even when its initiating view is gone', async () => {
		let finish!: (response: Response) => void;
		let requestedPath = '', requestedBody: unknown, requestedSignal: AbortSignal | null | undefined;
		globalThis.fetch = ((path, init) => {
			requestedPath = String(path);
			requestedBody = JSON.parse(String(init?.body));
			requestedSignal = init?.signal;
			return new Promise<Response>((resolve) => { finish = resolve; });
		}) as typeof fetch;
		const write = saveBudgetAcknowledgement(alert.id, true);
		let readReady = false;
		const barrier = waitForBudgetAlertMutations().then(() => { readReady = true; });
		await Promise.resolve();
		expect(readReady).toBe(false);
		expect(requestedPath).toBe('/api/control-plane/budget-alerts/alert%2F1/acknowledgement');
		expect(requestedBody).toEqual({ acknowledged: true });
		expect(requestedSignal).toBeUndefined();
		finish(Response.json(alert));
		expect(await write).toEqual(alert);
		await barrier;
		expect(readReady).toBe(true);
		await waitForBudgetAlertMutations();
	});

	test('failure propagates to the writer but permits an authoritative reload', async () => {
		globalThis.fetch = (async () => Response.json({ error: 'write unavailable' }, { status: 503 })) as typeof fetch;
		const write = saveBudgetAcknowledgement(alert.id, true);
		await expect(write).rejects.toThrow('write unavailable');
		await waitForBudgetAlertMutations();
	});

	test('malformed or mismatched success is never accepted as confirmed', async () => {
		for (const response of [{}, { ...alert, id: 'other' }, { ...alert, acknowledged: false }]) {
			globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
			await expect(saveBudgetAcknowledgement(alert.id, true)).rejects.toThrow('Invalid budget acknowledgement response');
			await waitForBudgetAlertMutations();
		}
	});

	test('both mutations share the read barrier and carry independent complete states', async () => {
		const finishes: Array<(response: Response) => void> = [];
		const bodies: unknown[] = [];
		globalThis.fetch = ((_path, init) => {
			expect(init?.signal).toBeUndefined();
			bodies.push(JSON.parse(String(init?.body)));
			return new Promise<Response>((resolve) => { finishes.push(resolve); });
		}) as typeof fetch;
		const confirmed = saveBudgetAcknowledgement(alert.id, true);
		const resolved = saveBudgetResolution(alert.id, true);
		let ready = false;
		const barrier = waitForBudgetAlertMutations().then(() => { ready = true; });
		expect(bodies).toEqual([{ acknowledged: true }, { resolved: true }]);
		finishes[0](Response.json(alert));
		await confirmed;
		expect(ready).toBe(false);
		const complete = { ...alert, resolved: true, resolved_at: '2026-10-29T12:00:00Z', resolved_by: 'local-admin' };
		finishes[1](Response.json(complete));
		expect(await resolved).toEqual(complete);
		await barrier;
		expect(ready).toBe(true);
	});

	test('resolution validates response identity, state and acknowledgement before success', async () => {
		const resolved = { ...alert, resolved: true, resolved_at: '2026-10-29T12:00:00Z', resolved_by: 'local-admin' };
		for (const response of [{}, { ...resolved, id: 'other' }, { ...resolved, resolved: false }, { ...resolved, acknowledged_at: null }]) {
			globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
			await expect(saveBudgetResolution(alert.id, true)).rejects.toThrow('Invalid budget resolution response');
			await waitForBudgetAlertMutations();
		}
		globalThis.fetch = (async () => Response.json(alert)) as typeof fetch;
		expect(await saveBudgetResolution(alert.id, false)).toEqual(alert);
	});
});
