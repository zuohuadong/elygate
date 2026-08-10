import { describe, expect, test } from 'bun:test';
import { columnLabelFor, columnValueFor, formatLocalDateTime } from './columns';

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

	test('localizes request-log columns in Chinese', () => {
		expect(columnLabelFor('zh-CN', 'parent_request_id')).toBe('父请求 ID');
		expect(columnLabelFor('zh-CN', 'object')).toBe('请求类型');
		expect(columnLabelFor('zh-CN', 'nl')).toBe('网络延迟');
	});
});

describe('columnValueFor cell rendering', () => {
	test('translates boolean columns to 是/否 in Chinese', () => {
		expect(columnValueFor('zh-CN', 'enabled', true)).toBe('是');
		expect(columnValueFor('zh-CN', 'disabled', false)).toBe('否');
		expect(columnValueFor('zh-CN', 'calendar_aligned', true)).toBe('是');
		expect(columnValueFor('zh-CN', 'include_response', false)).toBe('否');
		expect(columnValueFor('zh-CN', 'isCustom', true)).toBe('是');
	});

	test('translates boolean columns to Yes/No in English', () => {
		expect(columnValueFor('en', 'enabled', true)).toBe('Yes');
		expect(columnValueFor('en', 'disabled', false)).toBe('No');
	});

	test('translates known enum values by column', () => {
		expect(columnValueFor('zh-CN', 'kind', 'token')).toBe('令牌');
		expect(columnValueFor('zh-CN', 'auth_mode', 'headers')).toBe('请求头凭证');
		expect(columnValueFor('zh-CN', 'status', 'needs_reauth')).toBe('需重新认证');
		expect(columnValueFor('zh-CN', 'scope', 'global')).toBe('全局');
		expect(columnValueFor('zh-CN', 'scope_kind', 'provider_key')).toBe('供应商密钥');
		expect(columnValueFor('zh-CN', 'match_type', 'prefix')).toBe('前缀匹配');
		expect(columnValueFor('en', 'match_type', 'regex')).toBe('Regex');
	});

	test('falls back to raw value for unknown enum or non-enum columns', () => {
		expect(columnValueFor('zh-CN', 'name', 'openai')).toBe('openai');
		expect(columnValueFor('zh-CN', 'scope', 'custom_scope')).toBe('custom_scope');
		expect(columnValueFor('zh-CN', 'cost', 0.42)).toBe('0.42');
		expect(columnValueFor('zh-CN', 'events', ['created', 'completed'])).toBe('created, completed');
	});

	test('renders em dash for null and undefined', () => {
		expect(columnValueFor('zh-CN', 'customer_id', null)).toBe('—');
		expect(columnValueFor('en', 'expires_at', undefined)).toBe('—');
	});

	test('renders ISO timestamps as a compact local date-time', () => {
		const value = '2026-08-07T03:45:49.581964994Z';
		const date = new Date(value);
		const pad = (part: number) => String(part).padStart(2, '0');
		const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		expect(formatLocalDateTime(value)).toBe(expected);
		expect(columnValueFor('zh-CN', 'created_at', value)).toBe(expected);
		expect(columnValueFor('en', 'updated_at', 'not-a-date')).toBe('not-a-date');
	});
});
