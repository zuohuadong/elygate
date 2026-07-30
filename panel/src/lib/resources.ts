import type { MenuItem, ResourceDefinition } from '@svadmin/core';
import { labelFor, type ElygateLocale } from './i18n';

export function createResources(locale: ElygateLocale): ResourceDefinition[] {
	return [
		{
			name: 'providers',
			label: labelFor(locale, 'elygate.providers'),
			icon: 'server',
			fields: [],
			showInMenu: false,
		},
		{
			name: 'virtual-keys',
			label: labelFor(locale, 'elygate.virtualKeys'),
			icon: 'key-round',
			fields: [],
			showInMenu: false,
		},
		{
			name: 'models',
			label: labelFor(locale, 'elygate.models'),
			icon: 'bot',
			fields: [],
			showInMenu: false,
		},
		{
			name: 'logs',
			label: labelFor(locale, 'elygate.logs'),
			icon: 'scroll-text',
			fields: [],
			showInMenu: false,
		},
	];
}

export function createMenu(locale: ElygateLocale): MenuItem[] {
	return [
		{ name: 'dashboard', label: labelFor(locale, 'elygate.dashboard'), icon: 'layout-dashboard', href: '/' },
		{
			name: 'gateway',
			label: labelFor(locale, 'elygate.gateway'),
			icon: 'network',
			children: [
				{ name: 'providers', label: labelFor(locale, 'elygate.providers'), icon: 'server', href: '/providers' },
				{ name: 'virtual-keys', label: labelFor(locale, 'elygate.virtualKeys'), icon: 'key-round', href: '/virtual-keys' },
				{ name: 'models', label: labelFor(locale, 'elygate.models'), icon: 'bot', href: '/models' },
			],
		},
		{ name: 'logs', label: labelFor(locale, 'elygate.logs'), icon: 'scroll-text', href: '/logs' },
	];
}
