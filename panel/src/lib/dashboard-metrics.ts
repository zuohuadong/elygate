export interface MetricBucket {
	[key: string]: unknown;
}

export function finiteNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function weightedAverage(values: Array<{ value: number; weight: number }>): number {
	const weighted = values.reduce((sum, item) => sum + item.value * item.weight, 0);
	const weight = values.reduce((sum, item) => sum + item.weight, 0);
	return weight > 0 ? weighted / weight : 0;
}

export function bucketLatencyAverage(buckets: MetricBucket[]): number {
	return weightedAverage(buckets.map((bucket) => ({
		value: finiteNumber(bucket.avg_latency),
		weight: finiteNumber(bucket.total_requests),
	})));
}

export function providerMetric(bucket: MetricBucket, provider: string, field?: string): number {
	const byProvider = bucket.by_provider;
	if (!byProvider || typeof byProvider !== 'object' || Array.isArray(byProvider)) return 0;
	const providerValue = (byProvider as Record<string, unknown>)[provider];
	if (!field) return finiteNumber(providerValue);
	if (!providerValue || typeof providerValue !== 'object' || Array.isArray(providerValue)) return 0;
	return finiteNumber((providerValue as Record<string, unknown>)[field]);
}

export function sumProviderMetric(buckets: MetricBucket[], provider: string, field?: string): number {
	return buckets.reduce((sum, bucket) => sum + providerMetric(bucket, provider, field), 0);
}
