import { describe, expect, test } from 'bun:test';
import { columnLabelFor } from './columns';

describe('dynamic resource columns', () => {
	test('localizes known columns and humanizes unknown English columns', () => {
		expect(columnLabelFor('zh-CN', 'request_id')).toBe('请求 ID');
		expect(columnLabelFor('en', 'request_id')).toBe('Request ID');
		expect(columnLabelFor('en', 'cache_hit_rate')).toBe('Cache hit rate');
		expect(columnLabelFor('zh-CN', 'cache_hit_rate')).toBe('cache_hit_rate');
	});

	test('localizes skill table columns in Chinese', () => {
		expect(columnLabelFor('zh-CN', 'description')).toBe('描述');
		expect(columnLabelFor('zh-CN', 'license')).toBe('许可证');
		expect(columnLabelFor('zh-CN', 'compatibility')).toBe('兼容性');
		expect(columnLabelFor('zh-CN', 'created_at')).toBe('创建时间');
		expect(columnLabelFor('zh-CN', 'updated_at')).toBe('更新时间');
	});
});
