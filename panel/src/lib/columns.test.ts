import { describe, expect, test } from 'bun:test';
import { columnLabelFor } from './columns';

describe('dynamic resource columns', () => {
	test('localizes known columns and humanizes unknown English columns', () => {
		expect(columnLabelFor('zh-CN', 'request_id')).toBe('请求 ID');
		expect(columnLabelFor('en', 'request_id')).toBe('Request ID');
		expect(columnLabelFor('en', 'cache_hit_rate')).toBe('Cache hit rate');
		expect(columnLabelFor('zh-CN', 'cache_hit_rate')).toBe('cache_hit_rate');
	});
});
