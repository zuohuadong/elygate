import { isJsonRecord } from './api';
import { budgetQuery, parseBudgetStatuses, type BudgetStatus } from './control-plane-budgets';

export type BudgetWindow = BudgetStatus['window'];
export interface BudgetHistoryStatus extends BudgetStatus { scope_name: string; }
export interface BudgetHistoryPage {
	data: BudgetHistoryStatus[];
	total: number;
	limit: number;
	offset: number;
	window: BudgetWindow;
	start_time: string;
	end_time: string;
}
export interface BudgetHistoryRange { window: BudgetWindow; start: string; end: string; }

export function defaultBudgetHistoryRange(window: BudgetWindow, now = new Date()): BudgetHistoryRange {
	const end = new Date(now);
	end.setUTCHours(0, 0, 0, 0);
	const start = new Date(end);
	if (window === 'monthly') {
		end.setUTCDate(1);
		start.setUTCDate(1);
		start.setUTCMonth(start.getUTCMonth() - 12);
	} else start.setUTCDate(start.getUTCDate() - 30);
	const length = window === 'monthly' ? 7 : 10;
	return { window, start: start.toISOString().slice(0, length), end: end.toISOString().slice(0, length) };
}

function budgetHistoryBoundary(window: BudgetWindow, input: string): Date {
	const pattern = window === 'monthly' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
	if (!pattern.test(input)) throw new Error('invalid-budget-history-range');
	const boundary = new Date(`${input}${window === 'monthly' ? '-01' : ''}T00:00:00Z`);
	if (!Number.isFinite(boundary.getTime()) || boundary.getUTCFullYear() < 1
		|| boundary.toISOString().slice(0, input.length) !== input) throw new Error('invalid-budget-history-range');
	return boundary;
}

export function budgetHistoryRangeTimes(range: BudgetHistoryRange, now = new Date()): { start: string; end: string } {
	const start = budgetHistoryBoundary(range.window, range.start);
	const end = budgetHistoryBoundary(range.window, range.end);
	const closedBefore = budgetHistoryBoundary(range.window, defaultBudgetHistoryRange(range.window, now).end);
	const maximum = new Date(start);
	if (range.window === 'monthly') maximum.setUTCMonth(maximum.getUTCMonth() + 60);
	else maximum.setUTCDate(maximum.getUTCDate() + 366);
	if (start >= end || end > closedBefore || end > maximum) throw new Error('invalid-budget-history-range');
	return { start: start.toISOString(), end: end.toISOString() };
}

export function budgetHistoryQuery(range: BudgetHistoryRange, scope: { project: string; application: string }, offset: number): URLSearchParams {
	const times = budgetHistoryRangeTimes(range);
	const query = budgetQuery(scope.project, scope.application);
	query.set('window', range.window);
	query.set('start_time', times.start);
	query.set('end_time', times.end);
	query.set('limit', '25');
	query.set('offset', String(offset));
	return query;
}

function isHistoryStatus(status: BudgetStatus): status is BudgetHistoryStatus {
	return 'scope_name' in status && typeof status.scope_name === 'string'
		&& Date.parse(status.period_start) < Date.parse(status.period_end);
}

export function parseBudgetHistory(payload: unknown): BudgetHistoryPage {
	if (!isJsonRecord(payload) || (payload.window !== 'daily' && payload.window !== 'monthly')
		|| typeof payload.start_time !== 'string' || typeof payload.end_time !== 'string'
		|| !(Date.parse(payload.start_time) < Date.parse(payload.end_time))
		|| !Number.isSafeInteger(payload.total) || Number(payload.total) < 0
		|| !Number.isSafeInteger(payload.limit) || Number(payload.limit) < 1 || Number(payload.limit) > 100
		|| !Number.isSafeInteger(payload.offset) || Number(payload.offset) < 0) throw new Error('Invalid budget history response');
	const statuses = parseBudgetStatuses(payload);
	if (!statuses.every(isHistoryStatus) || statuses.length > Number(payload.limit)
		|| (statuses.length > 0 && Number(payload.offset) + statuses.length > Number(payload.total))
		|| !statuses.every(status => status.window === payload.window
			&& Date.parse(status.period_start) >= Date.parse(String(payload.start_time))
			&& Date.parse(status.period_end) <= Date.parse(String(payload.end_time)))) throw new Error('Invalid budget history response');
	return { data: statuses, total: Number(payload.total), limit: Number(payload.limit), offset: Number(payload.offset),
		window: payload.window, start_time: payload.start_time, end_time: payload.end_time };
}
