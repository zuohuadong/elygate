import { describe, expect, test } from 'bun:test';
import { registerElygateTranslations } from './i18n';
import { pageTitleForHash } from './page-metadata';

registerElygateTranslations();

describe('page metadata', () => {
	test('resolves localized titles from hash routes', () => {
		expect(pageTitleForHash('#/', 'zh-CN')).toBe('运行概览');
		expect(pageTitleForHash('#/virtual-keys', 'zh-CN')).toBe('虚拟密钥');
		expect(pageTitleForHash('#/models?records=1', 'zh-CN')).toBe('模型目录');
		expect(pageTitleForHash('#/virtual-keys', 'en')).toBe('Virtual keys');
		expect(pageTitleForHash('#/login', 'zh-CN')).toBe('登录');
	});

	test('labels unknown routes as missing pages', () => {
		expect(pageTitleForHash('#/missing-page', 'zh-CN')).toBe('页面未找到');
		expect(pageTitleForHash('#/missing-page', 'en')).toBe('Page not found');
	});

	test('uses runtime resource labels for extension pages', () => {
		expect(pageTitleForHash('#/custom-governance', 'zh-CN', { 'custom-governance': '自定义治理' })).toBe('自定义治理');
	});
});
