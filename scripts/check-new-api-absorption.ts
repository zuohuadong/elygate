import { join } from 'node:path';
import { pathExists, readJson, readText, walkFiles } from './lib/bun-io';

type AbsorptionDomain = {
    readonly id: string;
    readonly title: string;
    readonly priority: number;
    readonly newApiSignals: readonly string[];
    readonly elygateStatus: string;
    readonly elygateEvidence: readonly string[];
    readonly nextActions: readonly string[];
    readonly postgresNativePlan: string;
    readonly redisFreeGate: string;
};

type AbsorptionMatrix = {
    readonly version: number;
    readonly decision: {
        readonly kernel: string;
        readonly newApiRole: string;
        readonly apiCompatibilityPolicy: string;
        readonly runtimeCompatibilityPolicy: string;
        readonly redisPolicy: string;
        readonly postgresPolicy: string;
    };
    readonly sourceSnapshot: {
        readonly project: string;
        readonly commit: string;
        readonly checkedAt: string;
        readonly evidence: readonly string[];
    };
    readonly elygateEvidence: readonly string[];
    readonly acceptanceGates: readonly string[];
    readonly domains: readonly AbsorptionDomain[];
};

const workspaceRoot = new URL('..', import.meta.url).pathname;
const matrixPath = join(workspaceRoot, 'docs/new-api-absorption.matrix.json');
const schemaPath = join(workspaceRoot, 'docs/new-api-absorption.schema.json');
const planPath = join(workspaceRoot, 'docs/NEW_API_ABSORPTION.md');

const forbiddenRuntimePackages = [
    '@redis/client',
    '@upstash/redis',
    'bull',
    'bullmq',
    'ioredis',
    'redis',
];

const requiredDomainIds = [
    'protocol-openai-core',
    'protocol-provider-breadth',
    'operations-routing',
    'identity-billing-commerce',
    'security-compliance',
    'redis-free-platform',
];

function assert(condition: unknown, message: string, failures: string[]): asserts condition {
    if (!condition) failures.push(message);
}

async function readPackageJson(path: string): Promise<Record<string, unknown>> {
    return readJson<Record<string, unknown>>(path);
}

function dependencyMap(pkg: Record<string, unknown>): Record<string, string> {
    return {
        ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
        ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
        ...((pkg.optionalDependencies as Record<string, string> | undefined) ?? {}),
    };
}

async function listPackageJsonFiles(root: string): Promise<string[]> {
    return (await walkFiles(root)).filter((path) => path.endsWith('/package.json') || path === 'package.json');
}

function validateMatrix(matrix: AbsorptionMatrix, failures: string[]): void {
    assert(matrix.version === 1, 'matrix version must be 1', failures);
    assert(matrix.decision.kernel === 'elygate-postgres-native', 'matrix must preserve the Elygate PostgreSQL-native kernel', failures);
    assert(matrix.decision.newApiRole === 'product-and-protocol-reference', 'New API must be recorded as a reference, not the kernel', failures);
    assert(matrix.decision.apiCompatibilityPolicy === 'required-full-public-api-surface-compatibility', 'all public New API surfaces must be compatible before completion', failures);
    assert(matrix.decision.runtimeCompatibilityPolicy === 'forbidden-new-api-runtime-coupling', 'New API runtime coupling must stay forbidden', failures);
    assert(matrix.decision.redisPolicy === 'forbidden-runtime-dependency', 'Redis policy must forbid runtime dependency', failures);
    assert(matrix.decision.postgresPolicy === 'required-default-persistence', 'Postgres policy must remain required default persistence', failures);
    assert(matrix.sourceSnapshot.project === 'QuantumNous/new-api', 'source snapshot must identify QuantumNous/new-api', failures);
    assert(/^[0-9a-f]{7,40}$/.test(matrix.sourceSnapshot.commit), 'source snapshot must include a git commit hash', failures);
    assert(matrix.acceptanceGates.length >= 5, 'matrix must keep explicit acceptance gates', failures);
    assert(matrix.acceptanceGates.some((gate) => gate.toLowerCase().includes('every public') && gate.toLowerCase().includes('route')), 'matrix must require every public New API route surface', failures);
    assert(matrix.acceptanceGates.some((gate) => gate.toLowerCase().includes('runtime') && gate.toLowerCase().includes('internals')), 'matrix must forbid New API runtime/internal coupling', failures);

    const actualIds = new Set(matrix.domains.map((domain) => domain.id));
    for (const id of requiredDomainIds) {
        assert(actualIds.has(id), `missing absorption domain: ${id}`, failures);
    }

    for (const domain of matrix.domains) {
        assert(domain.title.length > 0, `domain ${domain.id} is missing title`, failures);
        assert(domain.newApiSignals.length > 0, `domain ${domain.id} is missing New API signals`, failures);
        assert(domain.elygateEvidence.length > 0, `domain ${domain.id} is missing Elygate evidence`, failures);
        assert(domain.nextActions.length > 0, `domain ${domain.id} is missing next actions`, failures);
        assert(domain.postgresNativePlan.toLowerCase().includes('postgres'), `domain ${domain.id} must state a PostgreSQL-native plan`, failures);
        assert(domain.redisFreeGate.toLowerCase().includes('redis'), `domain ${domain.id} must state a Redis-free gate`, failures);
    }
}

async function validateNoRedisRuntimeDependencies(failures: string[]): Promise<void> {
    const packageFiles = await listPackageJsonFiles(workspaceRoot);
    for (const file of packageFiles) {
        const pkg = await readPackageJson(file);
        const deps = dependencyMap(pkg);
        for (const forbidden of forbiddenRuntimePackages) {
            assert(!(forbidden in deps), `${file} declares forbidden Redis runtime dependency: ${forbidden}`, failures);
        }
    }
}

async function validateComposeFiles(failures: string[]): Promise<void> {
    const composeFiles = [
        'docker-compose.yml',
        'docker-compose.prod.yml',
        'docker-compose-remote.yml',
    ];
    for (const file of composeFiles) {
        const path = join(workspaceRoot, file);
        const source = await readText(path).catch(() => '');
        const redisServicePattern = /(^|\n)\s{2}redis:\s*(\n|$)/i;
        assert(!redisServicePattern.test(source), `${file} declares a default redis service`, failures);
    }
}

async function validatePlanReferences(matrix: AbsorptionMatrix, failures: string[]): Promise<void> {
    const plan = await readText(planPath);
    if (!(await pathExists(schemaPath))) {
        failures.push('schema file docs/new-api-absorption.schema.json must exist');
    }
    assert(plan.includes('docs/new-api-absorption.matrix.json'), 'plan must reference the machine-readable matrix', failures);
    assert(plan.includes('Redis-free'), 'plan must document Redis-free as a gate', failures);
    assert(plan.includes('PostgreSQL'), 'plan must document PostgreSQL as the default persistence', failures);
    assert(plan.includes(matrix.sourceSnapshot.commit), 'plan must include the New API source snapshot commit', failures);
}

const failures: string[] = [];
const matrix = await readJson<AbsorptionMatrix>(matrixPath);

validateMatrix(matrix, failures);
await validateNoRedisRuntimeDependencies(failures);
await validateComposeFiles(failures);
await validatePlanReferences(matrix, failures);

if (failures.length > 0) {
    console.error('[new-api-absorption] failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log('[new-api-absorption] ok');
