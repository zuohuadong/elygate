import { describe, expect, test } from 'bun:test';
import { budgetEndpoint, budgetLimits, budgetProgress, budgetQuery, formatBudgetAmount, parseBudgetAlerts, parseBudgetStatuses, validBudgetInput } from './control-plane-budgets';

describe('control-plane budget helpers', () => {
	test('blank amounts clear windows while positive decimals preserve sub-cent precision', () => {
		expect(budgetLimits('  ', '')).toEqual({ daily_budget: null, monthly_budget: null });
		expect(budgetLimits(' 10.50 ', '1e-8')).toEqual({ daily_budget: 10.5, monthly_budget: 1e-8 });
		expect(budgetLimits('.01', '5e-324').monthly_budget).toBe(Number.MIN_VALUE);
	});

	test('invalid amounts fail before a payload can clear a configured budget', () => {
		for (const amount of ['0', '-1', 'Infinity', 'NaN', '1e999', '1e-999', '0x10', '10 USD', '1,000']) {
			expect(validBudgetInput(amount)).toBe(false);
			expect(() => budgetLimits(amount, '10')).toThrow('invalid-budget-amount');
			expect(() => budgetLimits('10', amount)).toThrow('invalid-budget-amount');
		}
	});

	test('scope paths encode IDs and queries only include project/application', () => {
		expect(() => budgetEndpoint('project', '')).toThrow('budget-scope-required');
		expect(budgetEndpoint('application', 'app/1')).toBe('/api/control-plane/applications/app%2F1/budgets');
		expect(budgetQuery('', '').toString()).toBe('');
		expect(budgetQuery('project-1', 'app-1').toString()).toBe('project_id=project-1&application_id=app-1');
	});

	test('progress is clamped and tiny budgets do not display as zero', () => {
		expect(budgetProgress(12, 10)).toBe(100);
		expect(budgetProgress(-1, 10)).toBe(0);
		expect(budgetProgress(.8, 1)).toBe(80);
		expect(formatBudgetAmount(12.5, 'en-US')).toContain('$12.50');
		expect(formatBudgetAmount(1e-8, 'en-US')).not.toBe('$0.00');
		expect(formatBudgetAmount(Number.MIN_VALUE, 'en-US')).toContain('e-324');
		expect(Number.parseFloat(formatBudgetAmount(Number.MIN_VALUE, 'en-US').slice(1))).toBeGreaterThan(0);
	});

	test('malformed status/history payloads cannot appear as healthy or successfully empty', () => {
		expect(parseBudgetStatuses({ data: [] })).toEqual([]);
		expect(parseBudgetAlerts({ data: [] })).toEqual([]);
		for (const payload of [undefined, {}, { data: null }, { data: [null] }, { data: [{}] }]) {
			expect(() => parseBudgetStatuses(payload)).toThrow();
			expect(() => parseBudgetAlerts(payload)).toThrow();
		}
		const status = {
			scope_type: 'project', scope_id: 'p1', project_id: 'p1', window: 'daily',
			period_start: '2026-10-27T00:00:00Z', period_end: '2026-10-28T00:00:00Z',
			usage: .8, limit: 1, state: 'warning',
		};
		expect(parseBudgetStatuses({ data: [status] })).toEqual([status]);
		for (const patch of [{ state: 'ok' }, { limit: 0 }, { usage: NaN }, { period_end: 'invalid' }]) {
			expect(() => parseBudgetStatuses({ data: [{ ...status, ...patch }] })).toThrow();
		}
		const alert = { ...status, id: 'a1', threshold: .8, triggered_at: '2026-10-27T12:00:00Z' };
		expect(parseBudgetAlerts({ data: [alert] })).toEqual([alert]);
		expect(() => parseBudgetAlerts({ data: [{ ...alert, threshold: .5 }] })).toThrow();
	});
});
