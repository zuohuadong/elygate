import { describe, expect, test } from 'bun:test';
import { ApiError } from './api';
import { clampLogPage, costRecalculationConflict, formatLogCost, isCostRecalculationActive, isCostRecalculationStatus, isMissingCostRecalculation, logPageCount, waitForCostRecalculation } from './log-management';

describe('log management helpers', () => {
	test('derives pages from record count and page size', () => {
		expect(logPageCount(19, 50)).toBe(1);
		expect(logPageCount(167, 50)).toBe(4);
		expect(logPageCount(0, 50)).toBe(1);
		expect(clampLogPage(5, 167, 50)).toBe(4);
		expect(clampLogPage(0, 167, 50)).toBe(1);
	});

	test('recognizes structured recalculation responses', () => {
		expect(isCostRecalculationStatus({ id: 'job-1', status: 'running' })).toBe(true);
		expect(isCostRecalculationStatus({ error: 'conflict' })).toBe(false);
		expect(isCostRecalculationStatus(null)).toBe(false);
	});

	test('recognizes active recalculation states', () => {
		expect(isCostRecalculationActive({ status: 'pending' })).toBe(true);
		expect(isCostRecalculationActive({ status: 'running' })).toBe(true);
		expect(isCostRecalculationActive({ status: 'completed' })).toBe(false);
	});

	test('recognizes resumable conflicts and missing jobs', () => {
		const activeJob = { id: 'job-1', status: 'running' };
		expect(costRecalculationConflict(new ApiError(409, 'conflict', activeJob))).toEqual(activeJob);
		expect(costRecalculationConflict(new ApiError(409, 'conflict', { error: 'busy' }))).toBeUndefined();
		expect(isMissingCostRecalculation(new ApiError(404, 'missing'))).toBe(true);
		expect(isMissingCostRecalculation(new ApiError(503, 'temporary'))).toBe(false);
	});

	test('distinguishes missing cost data from an explicit zero cost', () => {
		expect(formatLogCost(undefined)).toBe('—');
		expect(formatLogCost(null)).toBe('—');
		expect(formatLogCost(0)).toBe('US$0.0000');
		expect(formatLogCost(0.0018)).toBe('US$0.0018');
	});

	test('polls until recalculation completes', async () => {
		const statuses = [
			{ id: 'job-1', status: 'pending' },
			{ id: 'job-1', status: 'running', processed: 2 },
			{ id: 'job-1', status: 'completed', processed: 3, updated: 2, skipped: 1 },
		];
		const result = await waitForCostRecalculation(
			'job-1',
			async () => statuses.shift() ?? { status: 'failed' },
			{ wait: async () => {}, intervalMs: 0 },
		);
		expect(result).toEqual({ id: 'job-1', status: 'completed', processed: 3, updated: 2, skipped: 1 });
	});

	test('fails after the polling budget is exhausted', async () => {
		await expect(waitForCostRecalculation(
			'job-1',
			async () => ({ status: 'running' }),
			{ wait: async () => {}, intervalMs: 0, maxAttempts: 2 },
		)).rejects.toThrow('cost-recalculation-timeout');
	});

	test('keeps polling without a default attempt limit', async () => {
		let attempts = 0;
		const result = await waitForCostRecalculation(
			'job-1',
			async () => {
				attempts += 1;
				return attempts === 125 ? { status: 'completed' } : { status: 'running' };
			},
			{ wait: async () => {}, intervalMs: 0 },
		);
		expect(result.status).toBe('completed');
		expect(attempts).toBe(125);
	});
});
