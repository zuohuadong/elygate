export interface EnterprisePanelBuildOptions {
	fallbackPath: string;
	modulePath?: string;
	required?: boolean;
}

export function resolveEnterprisePanelModule(options: EnterprisePanelBuildOptions): string;
