import { describe, expect, test } from 'bun:test';
import { usageTimeRange } from './control-plane-usage';

const errors = { start: 'invalid start', end: 'invalid end', range: 'invalid range' };

describe('usage ledger time filters', () => {
	test('leaves an empty window unbounded', () => {
		expect(usageTimeRange('  ', '', errors)).toEqual({ start: undefined, end: undefined });
	});

	test('converts datetime-local values in the browser timezone to RFC3339', () => {
		expect(usageTimeRange('2026-09-13T00:00', '2026-09-13T01:00', errors)).toEqual({
			start: new Date(2026, 8, 13, 0, 0).toISOString(),
			end: new Date(2026, 8, 13, 1, 0).toISOString(),
		});
	});

	test('normalizes explicit offsets without changing the selected instants', () => {
		expect(usageTimeRange(' 2026-09-13T00:00:00+08:00 ', '2026-09-13T01:00:00+08:00', errors)).toEqual({
			start: '2026-09-12T16:00:00.000Z',
			end: '2026-09-12T17:00:00.000Z',
		});
	});

	test('accepts either open bound', () => {
		expect(usageTimeRange('2026-09-13T00:00:00Z', '', errors)).toEqual({
			start: '2026-09-13T00:00:00.000Z', end: undefined,
		});
		expect(usageTimeRange('', '2026-09-13T00:00:00Z', errors)).toEqual({
			start: undefined, end: '2026-09-13T00:00:00.000Z',
		});
	});

	test('reports invalid, equal and reversed bounds before a request or download', () => {
		expect(() => usageTimeRange('invalid', '', errors)).toThrow(errors.start);
		expect(() => usageTimeRange('', 'invalid', errors)).toThrow(errors.end);
		expect(() => usageTimeRange('2026-09-13T01:00:00Z', '2026-09-13T01:00:00Z', errors)).toThrow(errors.range);
		expect(() => usageTimeRange('2026-09-13T02:00:00Z', '2026-09-13T01:00:00Z', errors)).toThrow(errors.range);
	});
});
