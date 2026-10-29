import { describe, expect, test } from 'bun:test';
import { collectRelayLogExport, exportTargetCount, relayLogCsvRow, relayLogListUrl, relayLogPage, relayLogsToCsv, RELAY_LOG_CSV_HEADERS } from './relay-log-export';

const page = (logs: Record<string, unknown>[], total = logs.length) => ({ logs, pagination: { total_count: total } });
const rows = (offset: number, limit: number) => Array.from({ length: limit }, (_, index) => ({ id: String(offset + index), cost: index / 10, request_body: 'excluded' }));

describe('relay log export', () => {
	test('keeps numeric zero, negative values and blank nullable fields distinct', () => {
		const csv = relayLogsToCsv([{
			timestamp: '2026-10-30T12:00:00Z', request_id: 'req-1', status: 'success', relay_name: 'main',
			kind: 'call', method: 'POST', path: '/chat', route_path: '/chat', model: 'model',
			latency: 0, upstream_latency: -1, cost: 0, extracted_cost: null, billable: false, streamed: true,
			virtual_key_id: 'vk-1', team_ids: ['team-1', 'team-2'], team_names: ['Team A', 'Team B'],
			user_agent: '=FORMULA()', job_id: 'job-1',
		}]);
		expect(csv).toContain('"0"');
		expect(csv).toContain('"-1"');
		expect(csv).toContain('""');
		expect(csv).toContain("\"'=FORMULA()\"");
		expect(csv).not.toContain('request_body');
		expect(csv).not.toContain('response_headers');
	});

	test('uses an explicit CSV whitelist with complete attribution and escaped multiline cells', () => {
		const record = {
			request_id: 'a,"b"\r\nc', cost: -2, units: 0, cost_per_request: null, virtual_key_id: 'vk',
			team_name: 'First team', team_names: ['First team'], team_ids: ['team-1', 'team-2'],
			customer_names: ['Customer A', 'Customer B'], customer_ids: ['c1', 'c2'], project_id: 'p1',
			request_body: 'secret-body', response_body: 'secret-response', request_headers: { authorization: 'secret-header' },
			metadata: { secret: 'secret-meta' }, plugin_logs: 'secret-plugin', user_name: '=cmd',
		};
		const csv = relayLogsToCsv([record]);
		const cells = relayLogCsvRow(record);
		expect(cells).toHaveLength(RELAY_LOG_CSV_HEADERS.length);
		expect(cells[26]).toBe('vk');
		expect(cells[27]).toBe('First team; team-2');
		expect(cells[28]).toBe('Customer A; Customer B');
		expect(cells[31]).toBe('p1');
		expect(cells[22]).toBe(-2);
		expect(cells[19]).toBe('');
		expect(relayLogCsvRow({ user_agent: 'client/1.0' })[9]).toBe('');
		expect(csv).toContain('"a,""b""\r\nc"');
		expect(csv).toContain("\"'=cmd\"");
		for (const secret of ['secret-body', 'secret-response', 'secret-header', 'secret-meta', 'secret-plugin']) expect(csv).not.toContain(secret);
		for (const name of ['=1+1', '+cmd', '-cmd', '@SUM(1)', ' \t=1', '\tplain', '\rplain', '\nplain']) expect(relayLogsToCsv([{ request_id: name }])).toContain(`"'${name}"`);
		expect(relayLogsToCsv([]).split('\r\n')).toHaveLength(2);
	});

	test('bounds export batches and rejects invalid explicit limits', () => {
		expect(exportTargetCount(15_000, '')).toBe(10_000);
		expect(exportTargetCount(15_000, '25')).toBe(25);
		expect(exportTargetCount(15, '25')).toBe(15);
		expect(() => exportTargetCount(15, '0')).toThrow('invalid-export-limit');
		expect(() => exportTargetCount(15, '10001')).toThrow('invalid-export-limit');
		for (const limit of ['abc', '-1', '1.2', 'Infinity']) expect(() => exportTargetCount(15, limit)).toThrow('invalid-export-limit');
		expect(exportTargetCount(0, '')).toBe(0);
		expect(exportTargetCount(1, ' 1 ')).toBe(1);
	});

	test('requires the upstream page contract instead of treating malformed success as empty', () => {
		expect(relayLogPage({ logs: null, pagination: { total_count: 0 } })).toEqual({ logs: [], total: 0 });
		for (const payload of [null, {}, [], { logs: [], pagination: {} }, { logs: [], pagination: { total_count: -1 } }, page([{}]), page([{ id: 1 }]), { logs: {}, pagination: { total_count: 0 } }]) {
			expect(() => relayLogPage(payload)).toThrow('invalid-relay-log-page');
		}
	});

	test('copies fixed query bounds into list and export pagination without mutating them', () => {
		const query = 'start_time=from&end_time=to&team_ids=a&team_ids=b&billable=false';
		const url = new URL(relayLogListUrl(query, { limit: 20, offset: 40, sortBy: 'cost', order: 'asc' }), 'https://test.invalid');
		expect(url.searchParams.getAll('team_ids')).toEqual(['a', 'b']);
		expect(url.searchParams.get('start_time')).toBe('from');
		expect(url.searchParams.get('end_time')).toBe('to');
		expect(url.searchParams.get('billable')).toBe('false');
		expect(url.searchParams.get('sort_by')).toBe('cost');
		expect(url.searchParams.get('order')).toBe('asc');
		expect(url.searchParams.get('offset')).toBe('40');
		expect(query).not.toContain('limit');
	});

	test('collects exact bounded batches and strips non-export payload before retaining rows', async () => {
		const calls: number[][] = [], progress: number[] = [];
		const collected = await collectRelayLogExport({
			target: 2_050, signal: new AbortController().signal,
			fetchBatch: async (offset, limit) => { calls.push([offset, limit]); return page(rows(offset, limit), 4_000); },
			onProgress: (count) => progress.push(count),
		});
		expect(calls).toEqual([[0, 1000], [1000, 1000], [2000, 50]]);
		expect(progress).toEqual([1000, 2000, 2050]);
		expect(collected).toHaveLength(2050);
		expect(collected.at(-1)?.id).toBe('2049');
		expect(collected[0]).not.toHaveProperty('request_body');
	});

	test('stops on a short or empty page, including zero matching rows', async () => {
		for (const count of [0, 1, 17]) {
			let calls = 0;
			const collected = await collectRelayLogExport({
				target: 300, signal: new AbortController().signal,
				fetchBatch: async () => { calls += 1; return page(rows(0, count)); }, onProgress: () => {},
			});
			expect(collected).toHaveLength(count);
			expect(calls).toBe(1);
		}
	});

	test('deduplicates overlapping pages but fails on repeated pages without infinite retries', async () => {
		const calls: number[][] = [];
		const collected = await collectRelayLogExport({
			target: 1100, signal: new AbortController().signal,
			fetchBatch: async (offset, limit) => { calls.push([offset, limit]); return page(rows(offset === 1000 ? 950 : offset, limit), 2000); },
			onProgress: () => {},
		});
		expect(collected).toHaveLength(1100);
		expect(new Set(collected.map((row) => row.id)).size).toBe(1100);
		expect(calls).toEqual([[0, 1000], [1000, 100], [1100, 50]]);
		await expect(collectRelayLogExport({
			target: 2000, signal: new AbortController().signal,
			fetchBatch: async () => page(rows(0, 1000), 2000), onProgress: () => {},
		})).rejects.toThrow('repeating-relay-log-page');
	});

	test('honors cancellation before and after a late response without progress or partial success', async () => {
		const controller = new AbortController();
		const progress: number[] = [];
		await expect(collectRelayLogExport({
			target: 10, signal: controller.signal,
			fetchBatch: async () => { controller.abort(); return page(rows(0, 10)); },
			onProgress: (count) => progress.push(count),
		})).rejects.toThrow();
		expect(progress).toEqual([]);
		let calls = 0;
		await expect(collectRelayLogExport({
			target: 10, signal: controller.signal, fetchBatch: async () => { calls += 1; return page([]); }, onProgress: () => {},
		})).rejects.toThrow();
		expect(calls).toBe(0);
	});

	test('propagates later errors instead of resolving to partially collected logs', async () => {
		await expect(collectRelayLogExport({
			target: 1100, signal: new AbortController().signal,
			fetchBatch: async (offset, limit) => { if (offset) throw new Error('network failed'); return page(rows(offset, limit), 1100); },
			onProgress: () => {},
		})).rejects.toThrow('network failed');
		await expect(collectRelayLogExport({
			target: 10, signal: new AbortController().signal, fetchBatch: async () => page(rows(0, 11)), onProgress: () => {},
		})).rejects.toThrow('invalid-relay-log-page');
	});

	test('bounds scanned rows when every batch overlaps but still adds new records', async () => {
		let scanned = 0;
		await expect(collectRelayLogExport({
			target: 10_000, signal: new AbortController().signal,
			fetchBatch: async (offset, limit) => { scanned += limit; return page(rows(offset / 1000, limit), 100_000); },
			onProgress: () => {},
		})).rejects.toThrow('relay-log-export-scan-limit');
		expect(scanned).toBe(10_000);
	});
});
