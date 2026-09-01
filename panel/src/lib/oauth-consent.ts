const blockedRedirectProtocols = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:']);

export function tempTokenFromFragment(fragment: string): string {
	if (!fragment.startsWith('#')) return '';
	return new URLSearchParams(fragment.slice(1)).get('t')?.trim() ?? '';
}

export function isSafeOAuthRedirect(value: string, baseUrl: string): boolean {
	try {
		return !blockedRedirectProtocols.has(new URL(value, baseUrl).protocol.toLowerCase());
	} catch {
		return false;
	}
}

export function expiryMinutes(value: string, now = Date.now()): number | undefined {
	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp) || timestamp <= now) return undefined;
	return Math.max(1, Math.ceil((timestamp - now) / 60_000));
}
