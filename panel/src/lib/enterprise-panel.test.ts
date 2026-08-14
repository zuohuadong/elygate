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
	translations: { en: { 'enterprise.users': 'Users' } },
} as unknown as EnterprisePanelManifest;

describe('enterprise panel manifest', () => {
	test('keeps legacy page exports compatible while letting the manifest take precedence', () => {
		const module = {
			enterpriseResourcePages: { users: { list: legacyPage } },
			enterprisePublicPages: { 'oauth-consent': legacyPublicPage },
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

	test('accepts an older module that only exports page maps', () => {
		const resolved = resolveEnterprisePanelManifest(
			{
				enterpriseResourcePages: { users: { list: legacyPage } },
				enterprisePublicPages: { 'oauth-consent': legacyPublicPage },
			} as unknown as EnterprisePanelModule,
			fallback,
		);

		expect(resolved.resources).toEqual(fallback.resources);
		expect(resolved.resourcePages.users?.list).toBe(legacyPage);
		expect(resolved.publicPages['oauth-consent']).toBe(legacyPublicPage);
	});
});
