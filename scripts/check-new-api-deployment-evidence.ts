import { join } from 'node:path';
import { readJson, readText } from './lib/bun-io';

type PackageJson = {
    readonly scripts?: Record<string, string>;
};

const workspaceRoot = new URL('..', import.meta.url).pathname;
const runbookPath = join(workspaceRoot, 'docs/ENTERPRISE_DEPLOYMENT_RUNBOOK.md');
const packagePath = join(workspaceRoot, 'package.json');

function fail(message: string, failures: string[]): void {
    failures.push(message);
}

function requireIncludes(source: string, needle: string, owner: string, failures: string[]): void {
    if (!source.includes(needle)) fail(`${owner} must include: ${needle}`, failures);
}

const runbook = await readText(runbookPath);
const packageJson = await readJson<PackageJson>(packagePath);
const rootCheck = packageJson.scripts?.check || '';
const failures: string[] = [];

for (const snippet of [
    'deployment_profile:',
    'bun run check',
    'bun run build',
    'bun run smoke:enterprise:db',
    'bun run smoke:enterprise:runtime',
    'git diff --check',
    'DATABASE_URL=postgresql://...',
    'SUPAUTH_JWKS_URL=',
    'ENTERPRISE_AUTH_MODE=strict',
    'PostgreSQL 备份或快照',
    '备份恢复演练',
    'bun run db:migrate',
    'curl -fsS https://gateway.example.com/api/status',
    'curl -fsS https://gateway.example.com/api/enterprise/health',
    'curl -fsS https://gateway.example.com/api/enterprise/manifest',
    '恢复上一个 artifact、镜像 tag 或 commit',
    'ELYGATE_LAYER=',
]) {
    requireIncludes(runbook, snippet, 'deployment runbook', failures);
}

for (const snippet of [
    'check:new-api-deployment-evidence',
    'smoke:enterprise:db',
    'smoke:enterprise:runtime',
]) {
    requireIncludes(rootCheck, snippet, 'root check script', failures);
}

if (failures.length > 0) {
    console.error('[new-api-deployment-evidence] failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log('[new-api-deployment-evidence] ok');
