import { describe, expect, test } from 'bun:test';
import { shouldApplyProviderKeyLoad, type ProviderKeyLoadSnapshot } from './provider-keys';

describe('provider key request ordering', () => {
	test('rejects a late response from the previously selected provider', () => {
		const providerA: ProviderKeyLoadSnapshot = { provider: 'openai', generation: 1 };
		const providerB: ProviderKeyLoadSnapshot = { provider: 'anthropic', generation: 2 };

		expect(shouldApplyProviderKeyLoad(providerB, 'anthropic', 2)).toBe(true);
		expect(shouldApplyProviderKeyLoad(providerA, 'anthropic', 2)).toBe(false);
	});

	test('rejects an older refresh and any response after selection is cleared', () => {
		const older: ProviderKeyLoadSnapshot = { provider: 'openai', generation: 3 };
		const latest: ProviderKeyLoadSnapshot = { provider: 'openai', generation: 4 };

		expect(shouldApplyProviderKeyLoad(older, 'openai', 4)).toBe(false);
		expect(shouldApplyProviderKeyLoad(latest, 'openai', 4)).toBe(true);
		expect(shouldApplyProviderKeyLoad(latest, '', 5)).toBe(false);
	});
});
