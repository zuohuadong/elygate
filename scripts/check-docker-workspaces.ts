import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const workspaceRoot = new URL('..', import.meta.url).pathname;
const dockerfiles = [
    'docker/Dockerfile.gateway',
    'docker/Dockerfile.web',
];

async function workspacePackageManifests(): Promise<string[]> {
    const groups = ['apps', 'packages'];
    const manifests: string[] = [];
    for (const group of groups) {
        const entries = await readdir(join(workspaceRoot, group), { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifest = `${group}/${entry.name}/package.json`;
            if (await Bun.file(join(workspaceRoot, manifest)).exists()) {
                manifests.push(manifest);
            }
        }
    }
    return manifests.sort();
}

const manifests = await workspacePackageManifests();
const failures: string[] = [];

for (const dockerfile of dockerfiles) {
    const path = join(workspaceRoot, dockerfile);
    const text = await Bun.file(path).text();
    if (!/^COPY\s+.*\btsconfig\.json\b.*\s+\.\//m.test(text)) {
        failures.push(`${dockerfile} must copy root tsconfig.json before bun install/build`);
    }
    for (const manifest of manifests) {
        const copyPattern = new RegExp(`^COPY\\s+${manifest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'm');
        if (!copyPattern.test(text)) {
            failures.push(`${dockerfile} must copy ${manifest} before bun install`);
        }
    }
}

if (failures.length > 0) {
    console.error('[docker-workspaces] contract failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`[docker-workspaces] ok (${manifests.length} workspace manifests across ${dockerfiles.length} Dockerfiles)`);
