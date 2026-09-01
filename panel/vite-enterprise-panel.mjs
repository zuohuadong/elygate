import { existsSync } from 'node:fs';

export function resolveEnterprisePanelModule(options) {
	if (!options.modulePath) {
		if (options.required) {
			throw new Error('BIFROST_ENTERPRISE_PANEL_PATH is required for an enterprise panel build.');
		}
		return options.fallbackPath;
	}
	if (!existsSync(options.modulePath)) {
		throw new Error(`Enterprise panel module does not exist: ${options.modulePath}`);
	}
	return options.modulePath;
}
