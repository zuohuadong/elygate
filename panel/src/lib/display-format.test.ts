import { describe, expect, test } from 'bun:test';
import { clampPaginationPage, formatPagination, formatRankedCost, formatUsdCost, paginationPageCount } from './display-format';

describe('display format helpers', () => {
	test('uses one USD precision across observability pages', () => {
		expect(formatUsdCost(undefined)).toBe('—');
		expect(formatUsdCost(0)).toBe('$0.0000');
		expect(formatUsdCost(0.0304215)).toBe('$0.0304');
	});

	test('distinguishes free usage from missing cost data', () => {
		expect(formatRankedCost(0, true, 'zh-CN')).toBe('$0.0000 · 免费');
		expect(formatRankedCost(0, true, 'en-US')).toBe('$0.0000 · Free');
		expect(formatRankedCost(0, false, 'zh-CN')).toBe('$0.0000');
		expect(formatRankedCost(undefined, true, 'zh-CN')).toBe('—');
		expect(formatRankedCost(null, true, 'zh-CN')).toBe('—');
		expect(formatRankedCost('', true, 'zh-CN')).toBe('—');
	});

	test('uses one pagination sentence', () => {
		expect(formatPagination(1, 3, 125, 'zh-CN')).toBe('第 1 / 3 页 · 共 125 条');
		expect(formatPagination(1, 3, 125, 'en-US')).toBe('Page 1 / 3 · 125 total');
		expect(paginationPageCount(125, 50)).toBe(3);
		expect(clampPaginationPage(3, 20, 50)).toBe(1);
	});
});
