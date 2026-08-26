import { addTranslations } from '@svadmin/core/i18n';
import type { Component } from 'svelte';
import type { EnterprisePublicRoute } from './public-routes';
import type { ElygateLocale } from './i18n';

export const ENTERPRISE_MENU_GROUPS = [
	'observability',
	'models-group',
	'mcp',
	'governance',
	'guardrails',
	'edge-control',
	'integrations',
	'system',
] as const;

export type EnterpriseMenuGroup = (typeof ENTERPRISE_MENU_GROUPS)[number];
export type EnterpriseResourcePage = { list: Component<{ resourceName: string }> };
export type EnterpriseResourcePages = Record<string, EnterpriseResourcePage>;
export type EnterprisePublicPages = Partial<Record<EnterprisePublicRoute, Component<{ route: EnterprisePublicRoute }>>>;

export interface EnterpriseResourceManifestEntry {
	name: string;
	icon: string;
	menuGroup: EnterpriseMenuGroup;
	menuOrder?: number;
	labels: Record<ElygateLocale, string>;
	hidden?: boolean;
}

export interface EnterprisePanelManifest {
	resources: readonly EnterpriseResourceManifestEntry[];
	resourcePages: EnterpriseResourcePages;
	fallbackResourcePages: EnterpriseResourcePages;
	publicPages: EnterprisePublicPages;
	translations: Partial<Record<ElygateLocale, Record<string, string>>>;
}

export interface EnterprisePanelModule {
	enterprisePanelManifest?: Partial<EnterprisePanelManifest>;
	enterpriseResourcePages?: EnterpriseResourcePages;
	enterprisePublicPages?: EnterprisePublicPages;
}

function mergeResources(
	fallback: readonly EnterpriseResourceManifestEntry[],
	overrides: readonly EnterpriseResourceManifestEntry[] = [],
): EnterpriseResourceManifestEntry[] {
	const resources = new Map(fallback.map((resource) => [resource.name, resource]));
	for (const resource of overrides) resources.set(resource.name, resource);
	return [...resources.values()];
}

function mergeTranslations(
	fallback: EnterprisePanelManifest['translations'],
	overrides: EnterprisePanelManifest['translations'] = {},
): EnterprisePanelManifest['translations'] {
	return {
		'zh-CN': { ...fallback['zh-CN'], ...overrides['zh-CN'] },
		en: { ...fallback.en, ...overrides.en },
	};
}

export function resolveEnterprisePanelManifest(
	module: EnterprisePanelModule,
	fallback: EnterprisePanelManifest,
): EnterprisePanelManifest {
	const manifest = module.enterprisePanelManifest ?? {};
	return {
		resources: mergeResources(fallback.resources, manifest.resources),
		fallbackResourcePages: {
			...fallback.fallbackResourcePages,
			...manifest.fallbackResourcePages,
		},
		resourcePages: {
			...fallback.resourcePages,
			...module.enterpriseResourcePages,
			...manifest.resourcePages,
		},
		publicPages: {
			...fallback.publicPages,
			...module.enterprisePublicPages,
			...manifest.publicPages,
		},
		translations: mergeTranslations(fallback.translations, manifest.translations),
	};
}

export function registerEnterprisePanelTranslations(manifest: EnterprisePanelManifest): void {
	for (const [locale, translations] of Object.entries(manifest.translations)) {
		if (translations) addTranslations(locale, translations);
	}
}
