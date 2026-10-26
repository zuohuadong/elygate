declare module '@elygate/enterprise-panel' {
	import type { EnterprisePanelManifest } from './lib/enterprise-panel';

	export const enterprisePanelAvailable: boolean;
	export const enterprisePanelManifest: Partial<EnterprisePanelManifest>;
}
