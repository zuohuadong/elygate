import { relative } from 'node:path';
import { readJson, readText, walkFiles } from './lib/bun-io';

const workspaceRoot = new URL('..', import.meta.url).pathname;

const allowedCachePackages = new Set([
    '@postgresx/noredis',
]);

const forbiddenCachePackages = [
    '@isaacs/ttlcache',
    '@keyv/redis',
    '@redis/client',
    '@upstash/redis',
    'cache-manager',
    'ioredis',
    'lru-cache',
    'node-cache',
    'quick-lru',
    'redis',
];

const packageJsonRoots = [
    'package.json',
    'apps',
    'packages/db',
    'packages/enterprise-adapter',
    'packages/enterprise-authz',
    'packages/enterprise-contracts',
    'packages/svadmin-core',
    'packages/svadmin-editor',
    'packages/svadmin-elysia',
    'packages/svadmin-helpers',
    'packages/svadmin-simple-rest',
    'packages/svadmin-ui',
];

const sourceRoots = [
    'apps',
    'packages/db',
    'packages/enterprise-adapter',
    'packages/enterprise-authz',
    'packages/enterprise-contracts',
    'packages/svadmin-core',
    'packages/svadmin-editor',
    'packages/svadmin-elysia',
    'packages/svadmin-helpers',
    'packages/svadmin-simple-rest',
    'packages/svadmin-ui',
    'scripts',
];

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function extension(path: string): string {
    const index = path.lastIndexOf('.');
    return index === -1 ? '' : path.slice(index);
}

function dependencyMap(pkg: Record<string, unknown>): Record<string, string> {
    return {
        ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
        ...((pkg.optionalDependencies as Record<string, string> | undefined) ?? {}),
        ...((pkg.peerDependencies as Record<string, string> | undefined) ?? {}),
    };
}

function importPattern(pkg: string): RegExp {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:from\\s+['"]${escaped}(?:/[^'"]*)?['"]|import\\s*\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\)|require\\s*\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\))`);
}

function isPackageJsonInScope(rel: string): boolean {
    if (rel === 'package.json') return true;
    return packageJsonRoots.some((root) => rel === `${root}/package.json` || rel.startsWith(`${root}/`) && rel.endsWith('/package.json'));
}

function isSourceInScope(rel: string): boolean {
    return sourceRoots.some((root) => rel === root || rel.startsWith(`${root}/`)) && sourceExtensions.has(extension(rel));
}

const failures: string[] = [];
const allFiles = await walkFiles(workspaceRoot);

for (const file of allFiles) {
    const rel = relative(workspaceRoot, file);
    if (!isPackageJsonInScope(rel)) continue;

    const pkg = await readJson<Record<string, unknown>>(file);
    const deps = dependencyMap(pkg);
    for (const forbidden of forbiddenCachePackages) {
        if (forbidden in deps) failures.push(`${rel} declares forbidden cache dependency: ${forbidden}`);
    }
    for (const dependency of Object.keys(deps)) {
        if (dependency.toLowerCase().includes('cache') && !allowedCachePackages.has(dependency)) {
            failures.push(`${rel} declares non-standard cache dependency: ${dependency}`);
        }
    }
}

for (const file of allFiles) {
    const rel = relative(workspaceRoot, file);
    if (!isSourceInScope(rel)) continue;

    const source = await readText(file).catch(() => '');
    for (const forbidden of forbiddenCachePackages) {
        if (importPattern(forbidden).test(source)) failures.push(`${rel} imports forbidden cache dependency: ${forbidden}`);
    }
}

if (failures.length > 0) {
    console.error('[cache-dependencies] failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log('[cache-dependencies] ok');
