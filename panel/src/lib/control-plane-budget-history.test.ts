import { describe, expect, test } from 'bun:test';
import { budgetHistoryQuery, budgetHistoryRangeTimes, defaultBudgetHistoryRange, parseBudgetHistory } from './control-plane-budget-history';

const now = new Date('2026-10-27T12:00:00Z');
const row = {
	scope_type: 'application', scope_id: 'a1', scope_name: 'Production app', project_id: 'p1',
	window: 'daily', period_start: '2026-10-26T00:00:00Z', period_end: '2026-10-27T00:00:00Z',
	usage: .8, limit: 1, state: 'warning',
};
const page = {
	data: [row], total: 26, limit: 25, offset: 0, window: 'daily',
	start_time: '2026-09-27T00:00:00Z', end_time: '2026-10-27T00:00:00Z',
};

describe('historical budget analysis', () => {
	test('defaults use closed UTC days and months across leap/year boundaries', () => {
		expect(defaultBudgetHistoryRange('daily', now)).toEqual({ window: 'daily', start: '2026-09-27', end: '2026-10-27' });
		expect(defaultBudgetHistoryRange('monthly', now)).toEqual({ window: 'monthly', start: '2025-10', end: '2026-10' });
		expect(defaultBudgetHistoryRange('daily', new Date('2024-03-01T00:00:00Z'))).toEqual({ window: 'daily', start: '2024-01-31', end: '2024-03-01' });
		expect(defaultBudgetHistoryRange('monthly', new Date('2026-01-31T23:59:59-08:00'))).toEqual({ window: 'monthly', start: '2025-02', end: '2026-02' });
	});

	test('ranges retain exclusive boundaries without local timezone conversion', () => {
		expect(budgetHistoryRangeTimes({ window: 'daily', start: '2024-02-29', end: '2024-03-01' }, now))
			.toEqual({ start: '2024-02-29T00:00:00.000Z', end: '2024-03-01T00:00:00.000Z' });
		expect(budgetHistoryRangeTimes({ window: 'monthly', start: '2021-10', end: '2026-10' }, now))
			.toEqual({ start: '2021-10-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' });
		expect(() => budgetHistoryRangeTimes({ window: 'monthly', start: '2021-09', end: '2026-10' }, now)).toThrow();
		expect(() => budgetHistoryRangeTimes({ window: 'daily', start: '2025-10-26', end: '2026-10-27' }, now)).not.toThrow();
		expect(() => budgetHistoryRangeTimes({ window: 'daily', start: '2025-10-25', end: '2026-10-27' }, now)).toThrow();
	});

	test('empty, normalized invalid dates, reversed and open ranges cannot issue requests', () => {
		for (const [start, end] of [
			['', '2026-10-27'], ['2026-10-26', ''], ['2026-02-30', '2026-03-01'],
			['0000-01-01', '0000-01-02'], ['2026-1-01', '2026-02-01'],
			['2026-10-27', '2026-10-26'], ['2026-10-27', '2026-10-27'],
			['2026-10-26', '2026-10-28'], ['2026-10-26T00:00:00Z', '2026-10-27'],
		]) expect(() => budgetHistoryRangeTimes({ window: 'daily', start, end }, now)).toThrow('invalid-budget-history-range');
		expect(() => budgetHistoryRangeTimes({ window: 'monthly', start: '2026-09', end: '2026-11' }, now)).toThrow();
		expect(() => budgetHistoryRangeTimes({ window: 'monthly', start: '2026-13', end: '2027-01' }, now)).toThrow();
	});

	test('history queries keep only scope and their own range/pagination', () => {
		const query = budgetHistoryQuery({ window: 'daily', start: '2024-02-29', end: '2024-03-01' }, { project: 'p/1', application: 'a&1' }, 25);
		expect(Object.fromEntries(query)).toEqual({
			project_id: 'p/1', application_id: 'a&1', window: 'daily',
			start_time: '2024-02-29T00:00:00.000Z', end_time: '2024-03-01T00:00:00.000Z', limit: '25', offset: '25',
		});
	});

	test('valid empty, zero-usage and offset-past-total pages remain truthful', () => {
		expect(parseBudgetHistory(page)).toEqual(page);
		expect(parseBudgetHistory({ ...page, data: [{ ...row, usage: 0, state: 'healthy' }] }).data[0]?.usage).toBe(0);
		expect(parseBudgetHistory({ ...page, data: [], total: 0, offset: 100 }).data).toEqual([]);
	});

	test('malformed records, metadata and range mismatches fail instead of appearing healthy/empty', () => {
		for (const patch of [
			{ data: null }, { data: [{}] }, { data: [{ ...row, scope_name: null }] },
			{ data: [{ ...row, window: 'monthly' }] }, { data: [{ ...row, period_start: row.period_end }] },
			{ data: [{ ...row, period_end: '2026-10-28T00:00:00Z' }] },
			{ data: [{ ...row, limit: 0 }] }, { data: [{ ...row, usage: Infinity }] },
			{ total: -1 }, { total: 0 }, { total: .5 }, { total: Number.MAX_SAFE_INTEGER + 1 },
			{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: '0' }, { window: 'weekly' },
			{ start_time: 'invalid' }, { start_time: page.end_time }, { end_time: 'invalid' },
		]) expect(() => parseBudgetHistory({ ...page, ...patch })).toThrow();
	});
});
