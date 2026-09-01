export interface ProviderKeyLoadSnapshot {
	provider: string;
	generation: number;
}

export function shouldApplyProviderKeyLoad(
	snapshot: ProviderKeyLoadSnapshot,
	selectedProvider: string,
	currentGeneration: number,
): boolean {
	return snapshot.provider.length > 0
		&& snapshot.provider === selectedProvider
		&& snapshot.generation === currentGeneration;
}
