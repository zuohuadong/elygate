import { afterEach, describe, expect, test } from 'bun:test';
import { saveBudgetAcknowledgement, waitForBudgetAcknowledgements } from './budget-acknowledgements';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const alert = {
	id: 'alert/1', scope_type: 'project', scope_id: 'p1', window: 'daily',
	period_start: '2026-10-27T00:00:00Z', threshold: .8, usage: 8, limit: 10,
	triggered_at: '2026-10-27T12:00:00Z', acknowledged: true,
	acknowledged_at: '2026-10-27T12:01:00Z', acknowledged_by: 'local-admin',
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
		const barrier = waitForBudgetAcknowledgements().then(() => { readReady = true; });
		await Promise.resolve();
		expect(readReady).toBe(false);
		expect(requestedPath).toBe('/api/control-plane/budget-alerts/alert%2F1/acknowledgement');
		expect(requestedBody).toEqual({ acknowledged: true });
		expect(requestedSignal).toBeUndefined();
		finish(Response.json(alert));
		expect(await write).toEqual(alert);
		await barrier;
		expect(readReady).toBe(true);
		await waitForBudgetAcknowledgements();
	});

	test('failure propagates to the writer but permits an authoritative reload', async () => {
		globalThis.fetch = (async () => Response.json({ error: 'write unavailable' }, { status: 503 })) as typeof fetch;
		const write = saveBudgetAcknowledgement(alert.id, true);
		await expect(write).rejects.toThrow('write unavailable');
		await waitForBudgetAcknowledgements();
	});

	test('malformed or mismatched success is never accepted as confirmed', async () => {
		for (const response of [{}, { ...alert, id: 'other' }, { ...alert, acknowledged: false }]) {
			globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
			await expect(saveBudgetAcknowledgement(alert.id, true)).rejects.toThrow('Invalid budget acknowledgement response');
			await waitForBudgetAcknowledgements();
		}
	});
});
