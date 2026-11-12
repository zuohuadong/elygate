/**
 * The gateway injects window.__BIFROST_BASE_PATH__ into the UI shell when it is
 * mounted under server.base_path. Every request the panel makes to its own
 * gateway and every gateway-relative link must carry that prefix, or a proxy
 * that only forwards the prefix never sees the request.
 */
export function normalizeBasePath(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const trimmed = raw.trim();
	if (!trimmed || trimmed === '/') return '';
	const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	return prefixed.replace(/\/+$/, '');
}

export function getBasePath(): string {
	if (typeof window === 'undefined') return '';
	return normalizeBasePath(window.__BIFROST_BASE_PATH__);
}

export function withBasePath(path: string, base = getBasePath()): string {
	if (!path.startsWith('/') || path.startsWith('//')) return path;
	if (!base || path === base || path.startsWith(`${base}/`)) return path;
	if (path === '/') return `${base}/`;
	return `${base}${path}`;
}

export function stripBasePath(path: string, base = getBasePath()): string {
	if (!base) return path;
	if (path === base) return '/';
	if (path.startsWith(`${base}/`)) return path.slice(base.length);
	return path;
}
