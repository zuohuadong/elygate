import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

type BoundaryRule = {
  readonly name: string;
  readonly root: string;
  readonly forbiddenImports: readonly string[];
  readonly allowList: readonly string[];
};

const workspaceRoot = new URL('..', import.meta.url).pathname;

const rules: readonly BoundaryRule[] = [
  {
    name: '基础网关层不能依赖企业级包',
    root: 'apps/gateway/src',
    forbiddenImports: ['@elygate/enterprise-contracts', '@elygate/enterprise-authz', '@elygate/enterprise-adapter'],
    allowList: [
      'apps/gateway/src/index.ts',
      'apps/gateway/src/enterprise/auth.ts',
      'apps/gateway/src/enterprise/budgetRollover.ts',
      'apps/gateway/src/enterprise/config.ts',
      'apps/gateway/src/enterprise/controlPlane.ts',
      'apps/gateway/src/enterprise/dbSmoke.ts',
      'apps/gateway/src/enterprise/router.ts',
      'apps/gateway/src/enterprise/router.test.ts',
      'apps/gateway/src/enterprise/resourceViews.ts',
      'apps/gateway/src/enterprise/runtimeGuard.ts',
      'apps/gateway/src/enterprise/runtimeGuard.test.ts',
    ],
  },
  {
    name: '通用面板层不能依赖企业级包',
    root: 'apps/admin/src',
    forbiddenImports: ['@elygate/enterprise-contracts', '@elygate/enterprise-authz', '@elygate/enterprise-adapter'],
    allowList: [],
  },
  {
    name: '基础设施包不能反向依赖企业级包',
    root: 'packages',
    forbiddenImports: ['@elygate/enterprise-contracts', '@elygate/enterprise-authz', '@elygate/enterprise-adapter'],
    allowList: [
      'packages/enterprise-authz/src/index.ts',
      'packages/enterprise-authz/src/budgetEvaluation.test.ts',
      'packages/enterprise-authz/src/policyEvaluation.test.ts',
      'packages/enterprise-adapter/src/index.ts',
    ],
  },
] as const;

async function listSourceFiles(root: string): Promise<string[]> {
  const absRoot = join(workspaceRoot, root);
  const entries = await readdir(absRoot, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    if (!/\.(ts|svelte)$/.test(entry.name)) return [];
    return [path];
  }));
  return files.flat();
}

function isAllowed(file: string, rule: BoundaryRule): boolean {
  return rule.allowList.includes(file);
}

function findForbiddenImports(source: string, forbiddenImports: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const specifier of forbiddenImports) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:from\\s+['\"]|import\\s*\\(['\"])${escaped}(?:['\"]|/)`);
    if (pattern.test(source)) hits.add(specifier);
  }
  return [...hits];
}

const violations: string[] = [];

for (const rule of rules) {
  const files = await listSourceFiles(rule.root);
  for (const file of files) {
    if (isAllowed(file, rule)) continue;
    const source = await readFile(join(workspaceRoot, file), 'utf8');
    const hits = findForbiddenImports(source, rule.forbiddenImports);
    for (const hit of hits) {
      violations.push(`${rule.name}: ${relative(workspaceRoot, join(workspaceRoot, file))} imports ${hit}`);
    }
  }
}

if (violations.length) {
  console.error('[layer-boundary] failed');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('[layer-boundary] ok');
