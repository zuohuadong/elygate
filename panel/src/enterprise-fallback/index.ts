import type { Component } from 'svelte';
import type { PublicPanelRoute } from '../lib/public-routes';

export type EnterpriseResourcePages = Record<string, { list: Component<{ resourceName: string }> }>;
export type EnterprisePublicPages = Partial<Record<PublicPanelRoute, Component<{ route: PublicPanelRoute }>>>;

export const enterprisePanelAvailable = false;
export const enterpriseResourcePages: EnterpriseResourcePages = {};
export const enterprisePublicPages: EnterprisePublicPages = {};
