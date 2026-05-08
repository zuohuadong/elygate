import type { BunFile } from 'bun';
import { join } from 'path';
import { embeddedAdminAssets } from '../generated/admin-assets';

/**
 * Static file serving middleware for SvelteKit build output.
 * Supports SPA fallback and immutable asset caching.
 */
const contentTypes: Record<string, string> = {
    js: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    html: 'text/html; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
};

function setStaticHeaders(path: string, set: { headers?: Record<string, string> }, contentType?: string) {
    if (!set.headers) set.headers = {};
    set.headers['Cache-Control'] = path.includes('/assets/') || path.includes('/_app/immutable/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, no-store, must-revalidate';

    const ext = path.split('.').pop() || '';
    set.headers['Content-Type'] = contentType || contentTypes[ext] || 'application/octet-stream';
}

function embeddedResponse(path: string, set: { headers?: Record<string, string> }) {
    const normalizedPath = path === '/' ? '/index.html' : path;
    const asset = embeddedAdminAssets[normalizedPath] || (!path.includes('.') ? embeddedAdminAssets['/index.html'] : undefined);
    if (!asset) return;

    setStaticHeaders(normalizedPath, set, asset.contentType);
    return new Response(Buffer.from(asset.base64, 'base64'), {
        headers: set.headers,
    });
}

export function staticFileHandler(): (ctx: { path: string; set: { status?: number; headers?: Record<string, string> } }) => Promise<BunFile | Response | undefined> {
    return async ({ path, set }: { path: string; set: { status?: number; headers?: Record<string, string> } }) => {
        if (path.startsWith('/api') || path.startsWith('/v1')) return;

        const buildPath = join(process.cwd(), 'apps/admin/dist');
        const normalizedPath = path === '/' ? '/index.html' : path;
        const isAsset = path.includes('.');

        const searchPaths = [
            join(buildPath, normalizedPath)
        ];

        for (const fullPath of searchPaths) {
            const file = Bun.file(fullPath);
            if (await file.exists()) {
                setStaticHeaders(path, set);
                return file;
            }
        }

        const embedded = embeddedResponse(path, set);
        if (embedded) return embedded;

        // SPA Fallback
        if (!isAsset) {
            const indexFile = Bun.file(join(buildPath, 'index.html'));
            if (await indexFile.exists()) {
                setStaticHeaders('/index.html', set, 'text/html; charset=utf-8');
                return indexFile;
            }
        }
    };
}
