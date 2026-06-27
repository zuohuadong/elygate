import { join } from 'node:path';
import { pathExists, readJson } from './lib/bun-io';

type RouteStatus = 'implemented' | 'partial' | 'missing' | 'blocked';

type RouteGroup = {
    readonly id: string;
    readonly status: RouteStatus;
    readonly source: string;
    readonly routes: readonly string[];
    readonly elygateEvidence: readonly string[];
    readonly blockers: readonly string[];
};

type RouteParityMatrix = {
    readonly version: number;
    readonly objective: string;
    readonly sourceSnapshot: {
        readonly project: string;
        readonly commit: string;
        readonly checkedAt: string;
        readonly evidence: readonly string[];
    };
    readonly completionPolicy: {
        readonly routeCoverage: string;
        readonly redisPolicy: string;
        readonly strictCommand: string;
    };
    readonly routeGroups: readonly RouteGroup[];
};

const workspaceRoot = new URL('..', import.meta.url).pathname;
const matrixPath = join(workspaceRoot, 'docs/new-api-route-parity.matrix.json');
const localEvidencePrefixes = ['docs/', 'apps/', 'packages/', 'scripts/', 'README.md'];

function fail(message: string, failures: string[]): void {
    failures.push(message);
}

function normalizeEvidencePath(evidence: string): string | null {
    const path = evidence.replace(/:\d+(?:-\d+)?$/, '');
    return localEvidencePrefixes.some((prefix) => path === prefix || path.startsWith(prefix)) ? path : null;
}

async function validateEvidencePaths(group: RouteGroup, failures: string[]): Promise<void> {
    for (const evidence of group.elygateEvidence) {
        const localPath = normalizeEvidencePath(evidence);
        if (!localPath) continue;
        if (!(await pathExists(join(workspaceRoot, localPath)))) {
            fail(`${group.id} references missing evidence path: ${evidence}`, failures);
        }
    }
}

function validateGroup(group: RouteGroup, failures: string[]): void {
    if (!group.id) fail('route group is missing id', failures);
    if (!group.source) fail(`${group.id} is missing New API source file`, failures);
    if (group.routes.length === 0) fail(`${group.id} must list at least one public route`, failures);
    if (group.elygateEvidence.length === 0) fail(`${group.id} must list Elygate evidence`, failures);
    if (group.status === 'implemented' && group.blockers.length > 0) {
        fail(`${group.id} is implemented but still lists blockers`, failures);
    }
    if (group.status !== 'implemented' && group.blockers.length === 0) {
        fail(`${group.id} is not implemented and must list blockers`, failures);
    }
}

function summarize(matrix: RouteParityMatrix): void {
    const totalRoutes = matrix.routeGroups.reduce((sum, group) => sum + group.routes.length, 0);
    const implementedRoutes = matrix.routeGroups
        .filter((group) => group.status === 'implemented')
        .reduce((sum, group) => sum + group.routes.length, 0);
    console.log(`[new-api-route-parity] ${implementedRoutes}/${totalRoutes} route patterns implemented`);
    for (const group of matrix.routeGroups) {
        if (group.status !== 'implemented') {
            console.log(`- ${group.id}: ${group.status}; blockers=${group.blockers.join('; ')}`);
        }
    }
}

const strict = process.argv.includes('--strict');
const failures: string[] = [];
const matrix = await readJson<RouteParityMatrix>(matrixPath);

if (matrix.version !== 1) fail('route parity matrix version must be 1', failures);
if (matrix.sourceSnapshot.project !== 'QuantumNous/new-api') fail('source snapshot must identify QuantumNous/new-api', failures);
if (!/^[0-9a-f]{7,40}$/.test(matrix.sourceSnapshot.commit)) fail('source snapshot must include a git commit hash', failures);
if (matrix.completionPolicy.routeCoverage !== 'all-public-routes-required') fail('route coverage policy must require all public routes', failures);
if (matrix.completionPolicy.redisPolicy !== 'forbidden-runtime-dependency') fail('Redis must remain forbidden for route parity', failures);
if (!matrix.completionPolicy.strictCommand.includes('check:new-api-route-parity-strict')) fail('strict route parity command must be documented', failures);

const ids = new Set<string>();
for (const group of matrix.routeGroups) {
    if (ids.has(group.id)) fail(`duplicate route group id: ${group.id}`, failures);
    ids.add(group.id);
    validateGroup(group, failures);
    await validateEvidencePaths(group, failures);
}

if (failures.length > 0) {
    console.error('[new-api-route-parity] contract failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

summarize(matrix);

if (strict) {
    const unfinished = matrix.routeGroups.filter((group) => group.status !== 'implemented');
    if (unfinished.length > 0) {
        console.error('[new-api-route-parity] strict gate failed');
        for (const group of unfinished) {
            console.error(`- ${group.id}: ${group.blockers.join('; ')}`);
        }
        process.exit(1);
    }
}

console.log('[new-api-route-parity] ok');
