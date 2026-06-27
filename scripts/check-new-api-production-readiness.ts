import { join } from 'node:path';
import { pathExists, readJson, readText } from './lib/bun-io';

type ProductionStatus = 'production-ready' | 'partial' | 'blocked' | 'not-started';

type Capability = {
    readonly id: string;
    readonly title: string;
    readonly priority: number;
    readonly status: ProductionStatus;
    readonly newApiReference: readonly string[];
    readonly elygateEvidence: readonly string[];
    readonly requiredGates: readonly string[];
    readonly verification: readonly string[];
    readonly nextActions: readonly string[];
    readonly blockers: readonly string[];
};

type ReadinessMatrix = {
    readonly version: number;
    readonly objective: string;
    readonly sourceSnapshot: {
        readonly project: string;
        readonly commit: string;
        readonly checkedAt: string;
        readonly evidence: readonly string[];
    };
    readonly productionDefinition: readonly string[];
    readonly capabilities: readonly Capability[];
};

const workspaceRoot = new URL('..', import.meta.url).pathname;
const matrixPath = join(workspaceRoot, 'docs/new-api-production-readiness.matrix.json');
const schemaPath = join(workspaceRoot, 'docs/new-api-production-readiness.schema.json');
const planPath = join(workspaceRoot, 'docs/NEW_API_PRODUCTION_READINESS.md');

const requiredCapabilities = [
    'redis-free-platform',
    'protocol-openai-core',
    'files-batches-assistants',
    'realtime',
    'provider-task-breadth',
    'operations-routing-admin',
    'identity-security',
    'billing-commerce',
    'observability-deployment',
    'admin-enterprise-ui',
];

const localEvidencePrefixes = [
    'README.md',
    'docs/',
    'apps/',
    'packages/',
    'scripts/',
];

function fail(message: string, failures: string[]): void {
    failures.push(message);
}

function includesAny(source: string, needles: readonly string[]): boolean {
    const lower = source.toLowerCase();
    return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

function normalizeEvidencePath(evidence: string): string | null {
    const path = evidence.replace(/:\d+(?:-\d+)?$/, '');
    return localEvidencePrefixes.some((prefix) => path === prefix || path.startsWith(prefix)) ? path : null;
}

async function validateEvidencePaths(paths: readonly string[], failures: string[], owner: string): Promise<void> {
    for (const evidence of paths) {
        const localPath = normalizeEvidencePath(evidence);
        if (!localPath) continue;
        if (!(await pathExists(join(workspaceRoot, localPath)))) {
            fail(`${owner} references missing evidence path: ${evidence}`, failures);
        }
    }
}

function validateMatrix(matrix: ReadinessMatrix, failures: string[]): void {
    if (matrix.version !== 1) fail('readiness matrix version must be 1', failures);
    if (matrix.sourceSnapshot.project !== 'QuantumNous/new-api') fail('source snapshot must identify QuantumNous/new-api', failures);
    if (!/^[0-9a-f]{7,40}$/.test(matrix.sourceSnapshot.commit)) fail('source snapshot must include a git commit hash', failures);
    if (matrix.productionDefinition.length < 5) fail('production definition must include concrete gates', failures);
    if (!includesAny(matrix.productionDefinition.join('\n'), ['every public New API route surface'])) {
        fail('production definition must require every public New API route surface', failures);
    }
    if (!includesAny(matrix.productionDefinition.join('\n'), ['without requiring New API runtime internals'])) {
        fail('production definition must forbid New API runtime/internal compatibility as a production dependency', failures);
    }

    const capabilityIds = new Set(matrix.capabilities.map((capability) => capability.id));
    for (const id of requiredCapabilities) {
        if (!capabilityIds.has(id)) fail(`missing production-readiness capability: ${id}`, failures);
    }

    for (const capability of matrix.capabilities) {
        if (!capability.title) fail(`${capability.id} is missing title`, failures);
        if (capability.newApiReference.length === 0) fail(`${capability.id} is missing New API reference`, failures);
        if (capability.elygateEvidence.length === 0) fail(`${capability.id} is missing Elygate evidence`, failures);
        if (capability.requiredGates.length === 0) fail(`${capability.id} is missing required gates`, failures);
        if (capability.verification.length === 0) fail(`${capability.id} is missing verification commands`, failures);
        if (capability.nextActions.length === 0) fail(`${capability.id} is missing next actions`, failures);
        if (!includesAny([...capability.requiredGates, ...capability.verification, ...capability.nextActions].join('\n'), ['test', 'smoke', 'check', 'evidence'])) {
            fail(`${capability.id} must name test, smoke, check, or evidence requirements`, failures);
        }
        if (capability.status === 'production-ready' && capability.blockers.length > 0) {
            fail(`${capability.id} is production-ready but still lists blockers`, failures);
        }
        if (capability.status !== 'production-ready' && capability.blockers.length === 0) {
            fail(`${capability.id} is not production-ready and must list blockers`, failures);
        }
    }
}

async function validateDocs(matrix: ReadinessMatrix, failures: string[]): Promise<void> {
    if (!(await pathExists(schemaPath))) fail('schema file docs/new-api-production-readiness.schema.json must exist', failures);
    const plan = await readText(planPath);
    if (!plan.includes('docs/new-api-production-readiness.matrix.json')) {
        fail('production readiness doc must reference the machine-readable matrix', failures);
    }
    if (!plan.includes('check:new-api-production-ready')) {
        fail('production readiness doc must describe the strict gate', failures);
    }
    if (!plan.includes(matrix.sourceSnapshot.commit)) {
        fail('production readiness doc must include the source snapshot commit', failures);
    }
}

async function validateAllEvidencePaths(matrix: ReadinessMatrix, failures: string[]): Promise<void> {
    for (const capability of matrix.capabilities) {
        await validateEvidencePaths(capability.elygateEvidence, failures, capability.id);
    }
}

function summarize(matrix: ReadinessMatrix): void {
    const counts = new Map<ProductionStatus, number>();
    for (const capability of matrix.capabilities) {
        counts.set(capability.status, (counts.get(capability.status) ?? 0) + 1);
    }

    const ready = counts.get('production-ready') ?? 0;
    const total = matrix.capabilities.length;
    console.log(`[new-api-production-readiness] ${ready}/${total} production-ready`);
    for (const capability of matrix.capabilities) {
        if (capability.status !== 'production-ready') {
            console.log(`- ${capability.id}: ${capability.status}; next=${capability.nextActions[0]}`);
        }
    }
}

const strict = process.argv.includes('--strict');
const failures: string[] = [];
const matrix = await readJson<ReadinessMatrix>(matrixPath);

validateMatrix(matrix, failures);
await validateDocs(matrix, failures);
await validateAllEvidencePaths(matrix, failures);

if (failures.length > 0) {
    console.error('[new-api-production-readiness] contract failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

summarize(matrix);

if (strict) {
    const unfinished = matrix.capabilities.filter((capability) => capability.status !== 'production-ready');
    if (unfinished.length > 0) {
        console.error('[new-api-production-readiness] strict gate failed');
        for (const capability of unfinished) {
            console.error(`- ${capability.id}: ${capability.blockers.join('; ')}`);
        }
        process.exit(1);
    }
}

console.log('[new-api-production-readiness] ok');
