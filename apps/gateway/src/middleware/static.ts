import type { BunFile } from 'bun';
import fs from 'fs';
import { join } from 'path';

/**
 * Static file serving middleware for SvelteKit build output.
 * Supports SPA fallback and immutable asset caching.
 */
export function staticFileHandler(): (ctx: { path: string; set: { status?: number; headers?: Record<string, string> } }) => Promise<BunFile | undefined> {
    return async ({ path, set }: { path: string; set: { status?: number; headers?: Record<string, string> } }) => {
        if (path.startsWith('/api') || path.startsWith('/v1')) return;

        const buildPath = join(process.cwd(), 'apps/web/build');
        const clientPath = join(buildPath, 'client');
        const prerenderedPath = join(buildPath, 'prerendered');

        const normalizedPath = path === '/' ? '/index.html' : path;
        const isAsset = path.includes('.');

        const searchPaths = [
            join(clientPath, path),
            join(prerenderedPath, normalizedPath.endsWith('.html') ? normalizedPath : `${normalizedPath}.html`),
            join(prerenderedPath, normalizedPath, 'index.html'),
            join(buildPath, normalizedPath)
        ];

        for (const fullPath of searchPaths) {
            const file = Bun.file(fullPath);
            if (await file.exists()) {
                if (path.includes('/_app/immutable/')) {
                    if (!set.headers) set.headers = {};
                set.headers['Cache-Control'] = 'public, max-age=31536000, immutable';
                } else {
                    if (!set.headers) set.headers = {};
                set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                }

                const ext = fullPath.split('.').pop();
                if (!set.headers) set.headers = {};
                if (ext === 'js') set.headers['Content-Type'] = 'application/javascript; charset=utf-8';
                else if (ext === 'css') set.headers['Content-Type'] = 'text/css; charset=utf-8';
                else if (ext === 'html') set.headers['Content-Type'] = 'text/html; charset=utf-8';
                else if (ext === 'json') set.headers['Content-Type'] = 'application/json; charset=utf-8';

                return file;
            }
        }

        // SPA Fallback
        if (!isAsset) {
            const indexFile = Bun.file(join(buildPath, 'index.html'));
            if (await indexFile.exists()) {
                if (!set.headers) set.headers = {};
                set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                set.headers['Content-Type'] = 'text/html; charset=utf-8';
                return indexFile;
            }
        }
    };
}
