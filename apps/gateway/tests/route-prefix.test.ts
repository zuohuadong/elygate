import { describe, expect, test } from 'bun:test';

const routeFiles = [
    'audio.ts',
    'capabilities.ts',
    'embeddings.ts',
    'images.ts',
    'moderations.ts',
    'workflows.ts',
    'responses.ts',
    'completions.ts',
    'files.ts',
    'batches.ts',
    'edits.ts',
    'realtime.ts',
    'openai-enterprise.ts'
];

describe('v1 route prefixes', () => {
    test('routes mounted inside /v1 do not declare another /v1 prefix', async () => {
        for (const file of routeFiles) {
            const source = await Bun.file(new URL(`../src/routes/${file}`, import.meta.url)).text();
            expect(source).not.toMatch(/new Elysia\(\{\s*prefix:\s*['"]\/v1/);
            expect(source).not.toMatch(/\.(get|post|put|patch|delete)\(\s*['"]\/v1\//);
        }
    });
});

describe('New API compatibility routes', () => {
    test('admin compatibility router exposes New API channel/token/log/model paths', async () => {
        const source = await Bun.file(new URL('../src/routes/admin/newApiCompat.ts', import.meta.url)).text();

        for (const route of [
            "'/channel/models'",
            "'/channel/models_enabled'",
            "'/channel/multi_key/manage'",
            "'/channel/upstream_updates/detect_all'",
            "'/channel/upstream_updates/apply_all'",
            "'/channel/tag/disabled'",
            "'/channel/tag/enabled'",
            "'/token/batch'",
            "'/token/batch/keys'",
            "'/log/search'",
            "'/option/channel_affinity_cache'",
            "'/models/sync_upstream/preview'",
            "'/ratio_sync/fetch'",
            "'/deployments/hardware-types'",
        ]) {
            expect(source).toContain(route);
        }
    });

    test('deployment compatibility router exposes io.net-backed endpoints', async () => {
        const source = await Bun.file(new URL('../src/routes/admin/newApiCompat.ts', import.meta.url)).text();

        for (const route of [
            "'/deployments/settings'",
            "'/deployments/settings/test-connection'",
            "'/deployments/search'",
            "'/deployments/hardware-types'",
            "'/deployments/locations'",
            "'/deployments/available-replicas'",
            "'/deployments/price-estimation'",
            "'/deployments/check-name'",
            "'/deployments/:id/logs'",
            "'/deployments/:id/containers/:container_id'",
            "'/deployments/:id/extend'",
            "'/clusters/check_cluster_name_availability'",
            "'/available-replicas'",
            "'/hardware/max-gpus-per-container'",
        ]) {
            expect(source).toContain(route);
        }
    });

    test('database defaults include io.net deployment options', async () => {
        const source = await Bun.file(new URL('../../../packages/db/src/init.sql', import.meta.url)).text();
        expect(source).toContain("'model_deployment.ionet.enabled'");
        expect(source).toContain("'model_deployment.ionet.api_key'");
        expect(source).toContain("'model_deployment.ionet.public_base_url'");
        expect(source).toContain("'model_deployment.ionet.enterprise_base_url'");
    });

    test('subscription payment compatibility routes are implemented', async () => {
        const source = await Bun.file(new URL('../src/routes/admin/newApiUserCompat.ts', import.meta.url)).text();
        expect(source).toContain('createSubscriptionPaymentOrder');
        expect(source).toContain(".post('/subscription/epay/pay'");
        expect(source).toContain(".post('/subscription/stripe/pay'");
        expect(source).toContain(".post('/subscription/creem/pay'");
        expect(source).toContain(".post('/subscription/waffo-pancake/pay'");
        expect(source).toContain(".post('/user/creem/pay'");
        expect(source).toContain(".post('/user/waffo/pay'");
        expect(source).toContain(".post('/user/waffo/amount'");
        expect(source).toContain(".post('/user/waffo-pancake/amount'");
        expect(source).toContain(".post('/user/waffo-pancake/pay'");
        expect(source).not.toContain(".post('/subscription/epay/pay', ({ set }: ElysiaCtx) => notImplemented");
        expect(source).not.toContain(".post('/subscription/stripe/pay', ({ set }: ElysiaCtx) => notImplemented");
        expect(source).not.toContain(".post('/subscription/creem/pay', ({ set }: ElysiaCtx) => notImplemented");
        expect(source).not.toContain(".post('/user/creem/pay', ({ set }: ElysiaCtx) => notImplemented");
        expect(source).not.toContain(".post('/user/waffo/pay', ({ set }: ElysiaCtx) => notImplemented");
        expect(source).not.toContain(".post('/user/waffo/amount', ({ set }: ElysiaCtx) => notImplemented");
    });

    test('core New API user and subscription routes are mounted without Redis', async () => {
        const source = await Bun.file(new URL('../src/routes/admin/newApiUserCompat.ts', import.meta.url)).text();

        for (const route of [
            ".post('/user/register'",
            ".post('/user/login'",
            ".get('/user/logout'",
            ".post('/user/logout'",
            ".get('/user/groups'",
            ".put('/subscription/self/preference'",
            ".get('/subscription/admin/plans'",
            ".post('/subscription/admin/plans'",
            ".put('/subscription/admin/plans/:id'",
            ".patch('/subscription/admin/plans/:id'",
            ".post('/subscription/admin/bind'",
            ".get('/subscription/admin/users/:id/subscriptions'",
            ".post('/subscription/admin/users/:id/subscriptions'",
            ".post('/subscription/admin/user_subscriptions/:id/invalidate'",
            ".delete('/subscription/admin/user_subscriptions/:id'",
            ".get('/redemption'",
            ".get('/redemption/search'",
            ".post('/redemption'",
            ".delete('/redemption/invalid'",
            ".post('/stripe/webhook'",
            ".post('/creem/webhook'",
            ".post('/waffo/webhook'",
            ".post('/waffo-pancake/webhook/:env'",
            ".post('/subscription/epay/notify'",
            ".get('/subscription/epay/notify'",
            ".post('/subscription/epay/return'",
            ".get('/subscription/epay/return'",
        ]) {
            expect(source).toContain(route);
        }

        expect(source).not.toMatch(/from ['"][^'"]*(redis|ioredis|bullmq|@upstash\/redis)[^'"]*['"]/i);
    });

    test('OpenAI-compatible video and dashboard billing aliases are present', async () => {
        const videoSource = await Bun.file(new URL('../src/routes/video.ts', import.meta.url)).text();
        const billingSource = await Bun.file(new URL('../src/routes/dashboard-billing.ts', import.meta.url)).text();
        const indexSource = await Bun.file(new URL('../src/index.ts', import.meta.url)).text();

        for (const route of [
            ".get('/video/generations/:taskId'",
            ".post('/videos'",
            ".get('/videos/:taskId'",
            ".post('/videos/:videoId/remix'",
        ]) {
            expect(videoSource).toContain(route);
        }
        for (const route of [
            ".get('/dashboard/billing/subscription'",
            ".get('/v1/dashboard/billing/subscription'",
            ".get('/dashboard/billing/usage'",
            ".get('/v1/dashboard/billing/usage'",
        ]) {
            expect(billingSource).toContain(route);
        }
        expect(indexSource).toContain('dashboardBillingRouter');
    });

    test('workspace dependencies stay Redis-free', async () => {
        for (const file of [
            '../../../package.json',
            '../package.json',
            '../../../packages/db/package.json',
        ]) {
            const source = await Bun.file(new URL(file, import.meta.url)).text();
            expect(source).not.toMatch(/"(@upstash\/redis|redis|ioredis|bullmq)"\s*:/);
        }
    });

    test('responses compact is constrained to OpenAI/Codex compatible channels', async () => {
        const source = await Bun.file(new URL('../src/routes/responses.ts', import.meta.url)).text();

        expect(source).toContain('ensureCompactSupported');
        expect(source).toContain('ChannelType.OPENAI');
        expect(source).toContain('ChannelType.CODEX');
        expect(source).toContain('/v1/responses/compact is only supported');
    });
});
