import { describe, expect, test } from 'bun:test';
import { bucketLatencyAverage, providerMetric, sumProviderMetric, weightedAverage } from './dashboard-metrics';

describe('dashboard metric aggregation', () => {
	test('weights latency buckets by request count instead of summing averages', () => {
		expect(bucketLatencyAverage([
			{ avg_latency: 100, total_requests: 9 },
			{ avg_latency: 1_000, total_requests: 1 },
		])).toBe(190);
		expect(weightedAverage([])).toBe(0);
	});

	test('reads provider request counts from latency buckets', () => {
		const bucket = { by_provider: { 'Agnes-AI': { avg_latency: 250, total_requests: 12 } } };
		expect(providerMetric(bucket, 'Agnes-AI', 'total_requests')).toBe(12);
		expect(providerMetric(bucket, 'Agnes-AI', 'avg_latency')).toBe(250);
		expect(sumProviderMetric([
			bucket,
			{ by_provider: { 'Agnes-AI': { total_requests: 8 } } },
		], 'Agnes-AI', 'total_requests')).toBe(20);
	});
});
