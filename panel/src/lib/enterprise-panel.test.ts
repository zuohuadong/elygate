import { describe, expect, test } from 'bun:test';
import type { EnterprisePanelManifest, EnterprisePanelModule } from './enterprise-panel';

(globalThis as Record<string, unknown>).$state = <Value>(value: Value): Value => value;
const { resolveEnterprisePanelManifest } = await import('./enterprise-panel');

const fallbackPage = Symbol('fallback-page');
const fallbackPublicPage = Symbol('fallback-public-page');
const legacyPage = Symbol('legacy-page');
const legacyPublicPage = Symbol('legacy-public-page');
const manifestPage = Symbol('manifest-page');
const manifestPublicPage = Symbol('manifest-public-page');

const fallback = {
	resources: [
		{
			name: 'users',
			icon: 'user-round',
			menuGroup: 'governance',
			labels: { 'zh-CN': '用户', en: 'Users' },
		},
	],
	resourcePages: {},
	fallbackResourcePages: { users: { list: fallbackPage } },
	publicPages: { 'oauth-consent': fallbackPublicPage },
	translations: { 'zh-CN': {}, en: { 'enterprise.users': 'Users' } },
} as unknown as EnterprisePanelManifest;

describe('enterprise panel manifest', () => {
	test('merges manifest pages, resources and translations with the OSS fallback', () => {
		const module = {
			enterprisePanelManifest: {
				resources: [
					{
						name: 'users',
						icon: 'users-round',
						menuGroup: 'governance',
						labels: { 'zh-CN': '成员', en: 'Members' },
					},
					{
						name: 'tenant-policies',
						icon: 'shield',
						menuGroup: 'governance',
						labels: { 'zh-CN': '租户策略', en: 'Tenant policies' },
					},
				],
				resourcePages: { users: { list: manifestPage } },
				publicPages: { 'oauth-consent': manifestPublicPage },
				translations: { en: { 'enterprise.users': 'Members' } },
			},
		} as unknown as EnterprisePanelModule;

		const resolved = resolveEnterprisePanelManifest(module, fallback);

		expect(resolved.resources.map((resource) => resource.name)).toEqual(['users', 'tenant-policies']);
		expect(resolved.resources[0]?.labels.en).toBe('Members');
		expect(resolved.resourcePages.users?.list).toBe(manifestPage);
		expect(resolved.fallbackResourcePages.users?.list).toBe(fallbackPage);
		expect(resolved.publicPages['oauth-consent']).toBe(manifestPublicPage);
		expect(resolved.translations.en).toEqual({ 'enterprise.users': 'Members' });
	});

	test('keeps the OSS fallback when the manifest has no overrides', () => {
		const resolved = resolveEnterprisePanelManifest(
			{ enterprisePanelManifest: {} },
			fallback,
		);

		expect(resolved).toEqual(fallback);
	});

	test('rejects modules that only export removed page maps', () => {
		expect(() => resolveEnterprisePanelManifest(
			{
				enterpriseResourcePages: { users: { list: legacyPage } },
				enterprisePublicPages: { 'oauth-consent': legacyPublicPage },
			} as unknown as EnterprisePanelModule,
			fallback,
		)).toThrow('Enterprise panel modules must export enterprisePanelManifest');
	});

	test('does not read removed page maps alongside a manifest', () => {
		const resolved = resolveEnterprisePanelManifest(
			{
				enterprisePanelManifest: {},
				enterpriseResourcePages: { users: { list: legacyPage } },
				enterprisePublicPages: { 'oauth-consent': legacyPublicPage },
			} as unknown as EnterprisePanelModule,
			fallback,
		);

		expect(resolved).toEqual(fallback);
	});
});
