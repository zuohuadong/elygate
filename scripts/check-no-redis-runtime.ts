import { join, relative } from 'node:path';
import { readJson, readText, walkFiles } from './lib/bun-io';

const workspaceRoot = new URL('..', import.meta.url).pathname;

const forbiddenRuntimePackages = [
    '@redis/client',
    '@upstash/redis',
    'bull',
    'bullmq',
    'ioredis',
    'redis',
];

const sourceRoots = [
    'apps',
    'packages',
    'scripts',
];

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isPackageJson(path: string): boolean {
    return path.endsWith('/package.json') || path === 'package.json';
}

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
    return new RegExp(`(?:from\\s+['"]${escaped}['"]|import\\s*\\(\\s*['"]${escaped}['"]\\s*\\)|require\\s*\\(\\s*['"]${escaped}['"]\\s*\\))`);
}

const failures: string[] = [];
const allFiles = await walkFiles(workspaceRoot);

for (const file of allFiles.filter((path) => isPackageJson(relative(workspaceRoot, path)))) {
    const rel = relative(workspaceRoot, file);
    const pkg = await readJson<Record<string, unknown>>(file);
    const deps = dependencyMap(pkg);
    for (const forbidden of forbiddenRuntimePackages) {
        if (forbidden in deps) {
            failures.push(`${rel} declares forbidden Redis runtime dependency: ${forbidden}`);
        }
    }
}

for (const composeFile of ['docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose-remote.yml']) {
    const source = await readText(join(workspaceRoot, composeFile)).catch(() => '');
    if (/(^|\n)\s{2}redis:\s*(\n|$)/i.test(source)) {
        failures.push(`${composeFile} declares a default redis service`);
    }
}

const sourceFiles = allFiles.filter((file) => {
    const rel = relative(workspaceRoot, file);
    return sourceRoots.some((root) => rel === root || rel.startsWith(`${root}/`)) && sourceExtensions.has(extension(rel));
});

for (const file of sourceFiles) {
    const rel = relative(workspaceRoot, file);
    const source = await readText(file).catch(() => '');
    for (const forbidden of forbiddenRuntimePackages) {
        if (importPattern(forbidden).test(source)) {
            failures.push(`${rel} imports forbidden Redis runtime package: ${forbidden}`);
        }
    }
}

if (failures.length > 0) {
    console.error('[no-redis-runtime] failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log('[no-redis-runtime] ok');
