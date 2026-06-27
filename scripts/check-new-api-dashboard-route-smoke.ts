import { join } from 'node:path';
import { readText } from './lib/bun-io';

const workspaceRoot = new URL('..', import.meta.url).pathname;

const routeSources = [
    'apps/gateway/src/routes/sys.ts',
    'apps/gateway/src/routes/admin/newApiCompat.ts',
    'apps/gateway/src/routes/admin/newApiUserCompat.ts',
    'apps/gateway/src/routes/stats.ts',
    'apps/gateway/src/routes/payment.ts',
];

const requiredFragments = [
    "'/token'",
    "'/token/search'",
    "'/token/:id'",
    "'/usage/token'",
    "'/log/self'",
    "'/channel'",
    "'/channel/search'",
    "'/channel/upstream_updates/detect'",
    "'/channel/upstream_updates/apply'",
    "'/models'",
    "'/models/search'",
    "'/deployments'",
    "'/deployments/settings'",
    "'/subscription/plans'",
    "'/subscription/self'",
    "'/subscription/admin/plans'",
    "'/user/self'",
    "'/user/models'",
    "'/user/2fa/status'",
    "'/user/passkey'",
    "'/custom-oauth-provider'",
    "'/redemption'",
    "'/data/self'",
    "'/announcement/public'",
];

const combined = (await Promise.all(routeSources.map((source) =>
    readText(join(workspaceRoot, source))
))).join('\n');

const failures = requiredFragments.filter((fragment) => !combined.includes(fragment));

if (failures.length > 0) {
    console.error('[new-api-dashboard-route-smoke] failed');
    for (const failure of failures) console.error(`- missing route fragment ${failure}`);
    process.exit(1);
}

console.log(`[new-api-dashboard-route-smoke] ok (${requiredFragments.length} route fragments)`);
