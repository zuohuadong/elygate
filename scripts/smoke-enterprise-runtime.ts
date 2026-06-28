import { chromium, type Page } from 'playwright';
import {
    findFreePort,
    run,
    startPostgres,
    stopPostgres,
} from './enterprise-smoke-postgres';
import {
    isAddressInUseError,
    runGatewayWithRetries,
} from './enterprise-smoke-gateway-retry';

let gatewayPort = 0;
let databaseUrl = '';
let gatewayUrl = '';
let mockUpstreamUrl = '';
const TENANT_ID = 'tenant_runtime_smoke';
const ORG_ID = 'org_runtime_smoke';
const APP_INSTANCE_ID = 'agi_runtime_smoke';
const PROJECT_ID = 'project_runtime_smoke';
const WORKSPACE_ID = PROJECT_ID;
const APP_ID = 'elygate-ai-gateway';

type JsonObject = Record<string, unknown>;
type SpawnedProcess = ReturnType<typeof Bun.spawn>;
type BunServer = ReturnType<typeof Bun.serve>;

type MockUpstreamMessage = {
    readonly role?: string;
    readonly content?: unknown;
};

type MockUpstreamRequest = {
    readonly path: string;
    readonly authorization: string | null;
    readonly model?: string;
    readonly traceId?: string;
    readonly messages?: readonly MockUpstreamMessage[];
};

type ApiEnvelope<T> = {
    readonly success: boolean;
    readonly data?: T;
    readonly message?: string;
};

type GatewayInstance = {
    readonly id: number | string;
    readonly app_instance_id: string;
    readonly status: string;
};

type PanelChannel = {
    readonly id: number | string;
    readonly name: string;
    readonly status?: number;
    readonly key?: string;
    readonly models?: readonly string[];
};

type PanelToken = {
    readonly id: number | string;
    readonly name: string;
    readonly key?: string;
    readonly status?: number;
    readonly rateLimit?: number;
};

type PanelLogList = {
    readonly data: readonly JsonObject[];
    readonly total: number;
};

type PanelModelStatus = {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly latency?: number;
};

type PanelModelMetadata = {
    readonly id: number | string;
    readonly modelName: string;
    readonly type?: string;
    readonly displayName?: string | null;
    readonly tags?: readonly string[];
};

type PanelSuccessData<T> = {
    readonly success: boolean;
    readonly data: T;
    readonly count?: number;
    readonly total?: number;
    readonly message?: string;
};

type PanelRatioConfig = {
    readonly modelRatio?: Record<string, number>;
    readonly completionRatio?: Record<string, number>;
    readonly groupRatio?: Record<string, number>;
    readonly fixedCostModels?: Record<string, number>;
};

type PanelMemoryStats = {
    readonly total: number;
    readonly active: number;
};

type PanelMemoryList = {
    readonly success: boolean;
    readonly data: readonly JsonObject[];
    readonly total: number;
};

type PanelUser = {
    readonly id: number | string;
    readonly username: string;
    readonly role?: number;
    readonly quota?: number;
    readonly status?: number;
};

type PanelUserGroup = {
    readonly key: string;
    readonly name: string;
    readonly status?: number;
};

type PanelRateLimit = {
    readonly id: number | string;
    readonly name: string;
    readonly rpm?: number;
    readonly rph?: number;
    readonly concurrent?: number;
};

type PanelPackage = {
    readonly id: number | string;
    readonly name: string;
    readonly price?: string | number;
    readonly durationDays?: number;
    readonly isPublic?: boolean;
};

type PanelRedemption = {
    readonly id: number | string;
    readonly name: string;
    readonly key: string;
    readonly quota?: number;
    readonly count?: number;
    readonly status?: number;
};

type PanelVendor = {
    readonly id: number | string;
    readonly name: string;
    readonly type?: number;
    readonly baseUrl?: string;
};

type PanelDataEnvelope<T> = {
    readonly success: boolean;
    readonly data: T;
    readonly message?: string;
};

type LoginResponse = {
    readonly success: boolean;
    readonly token?: string;
    readonly message?: string;
};

const mockUpstreamRequests: MockUpstreamRequest[] = [];

const ENTERPRISE_SCOPES = [
    'ai.gateway.admin',
    'ai.gateway.read',
    'ai.key.manage',
    'ai.usage.read',
    'ai.policy.manage',
    'ai.channel.manage',
    'ai.audit.read',
    'ai.memory.manage',
] as const;

function parsePort(value: string | undefined, label: string): number | null {
    if (!value) return null;
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`${label} must be a valid TCP port, got ${value}`);
    }
    return port;
}

function encodeSegment(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createSupAuthToken(): string {
    return `${encodeSegment({ alg: 'none', typ: 'JWT' })}.${encodeSegment({
        tenant_id: TENANT_ID,
        org_id: ORG_ID,
        app_id: APP_ID,
        app_instance_id: APP_INSTANCE_ID,
        project_id: PROJECT_ID,
        user_id: 'user_runtime_smoke',
        membership_id: 'membership_runtime_smoke',
        roles: ['owner'],
        scopes: ENTERPRISE_SCOPES,
        entitlements_version: 1,
        aud: gatewayUrl,
    })}.`;
}

function startMockOpenAIUpstream(port: number): BunServer {
    mockUpstreamRequests.length = 0;
    return Bun.serve({
        hostname: '127.0.0.1',
        port,
        async fetch(request) {
            const url = new URL(request.url);
            if (request.method === 'GET' && url.pathname === '/v1/models') {
                return Response.json({
                    object: 'list',
                    data: [
                        { id: 'gpt-4.1', object: 'model', created: 1, owned_by: 'runtime-smoke' },
                    ],
                });
            }

            if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
                const body = await request.json().catch(() => ({})) as JsonObject;
                mockUpstreamRequests.push({
                    path: url.pathname,
                    authorization: request.headers.get('authorization'),
                    model: typeof body.model === 'string' ? body.model : undefined,
                    traceId: typeof body.trace_id === 'string' ? body.trace_id : undefined,
                    messages: Array.isArray(body.messages)
                        ? body.messages
                            .filter((message): message is MockUpstreamMessage => !!message && typeof message === 'object')
                            .map((message) => ({
                                role: typeof message.role === 'string' ? message.role : undefined,
                                content: message.content,
                            }))
                        : undefined,
                });
                return Response.json({
                    id: 'chatcmpl-runtime-smoke',
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: body.model || 'gpt-4.1',
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: 'runtime smoke completion from mock upstream',
                            },
                            finish_reason: 'stop',
                        },
                    ],
                    usage: {
                        prompt_tokens: 7,
                        completion_tokens: 5,
                        total_tokens: 12,
                        prompt_tokens_details: { cached_tokens: 2 },
                    },
                });
            }

            return Response.json({ error: `unexpected mock upstream route ${request.method} ${url.pathname}` }, { status: 404 });
        },
    });
}

function runtimeEnv(): Record<string, string> {
    return {
        DATABASE_URL: databaseUrl,
        PORT: String(gatewayPort),
        GATEWAY_URL: gatewayUrl,
        WEB_URL: gatewayUrl,
        JWT_SECRET: 'runtime-smoke-jwt-secret',
        ADMIN_PASSWORD: 'runtime-smoke-admin-password',
        ENCRYPTION_SECRET: 'runtime-smoke-encryption-secret',
        ENCRYPTION_SALT: 'runtime-smoke-salt',
        ELYGATE_LAYER: 'enterprise',
        ELYGATE_TENANT_ID: TENANT_ID,
        ELYGATE_ORG_ID: ORG_ID,
        ELYGATE_PROJECT_ID: PROJECT_ID,
        ELYGATE_APP_INSTANCE_ID: APP_INSTANCE_ID,
        SUPAUTH_AUDIENCE: gatewayUrl,
        ENTERPRISE_AUTH_MODE: 'dev',
        PG_BOSS_SCHEMA: 'pgboss_runtime_smoke',
        PG_BOSS_APP_NAME: 'elygate-runtime-smoke',
    };
}

async function seedCoreGatewayData(): Promise<void> {
    const sql = new Bun.SQL(databaseUrl);
    try {
        const now = new Date();
        const partitionStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const partitionEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        const partitionName = `logs_y${partitionStart.getUTCFullYear()}m${String(partitionStart.getUTCMonth() + 1).padStart(2, '0')}`;
        await sql.unsafe(
            `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF logs FOR VALUES FROM ('${partitionStart.toISOString()}') TO ('${partitionEnd.toISOString()}')`,
        );

        const [user] = await sql`
            INSERT INTO users (username, password_hash, role, quota)
            VALUES ('runtime_smoke_user', '', 10, 1000000)
            ON CONFLICT (username) DO UPDATE SET updated_at = NOW()
            RETURNING id
        ` as Array<{ id: number }>;
        const [channel] = await sql`
            INSERT INTO channels (type, name, base_url, key, models, status, endpoint_type)
            VALUES (1, 'Runtime Smoke OpenAI', ${mockUpstreamUrl}, 'sk-runtime-smoke-provider', '["gpt-4.1"]'::jsonb, 1, 'chat')
            RETURNING id
        ` as Array<{ id: number }>;
        const [token] = await sql`
            INSERT INTO tokens (user_id, name, key, status, remain_quota, used_quota, models)
            VALUES (${user.id}, 'Runtime Smoke Key', 'sk-runtime-smoke-key', 1, 1000000, 123, '["gpt-4.1"]'::jsonb)
            ON CONFLICT (key) DO UPDATE SET updated_at = NOW()
            RETURNING id
        ` as Array<{ id: number }>;
        await sql`
            INSERT INTO tokens (user_id, name, key, status, remain_quota, used_quota, models, rate_limit)
            VALUES (${user.id}, 'Runtime Smoke Limited Key', 'sk-runtime-smoke-limited-key', 1, 1000000, 0, '["gpt-4.1"]'::jsonb, 1)
            ON CONFLICT (key) DO UPDATE SET
                status = EXCLUDED.status,
                remain_quota = EXCLUDED.remain_quota,
                used_quota = EXCLUDED.used_quota,
                models = EXCLUDED.models,
                rate_limit = EXCLUDED.rate_limit,
                updated_at = NOW()
        `;
        await sql`
            INSERT INTO options (key, value)
            VALUES
                ('MemoryEnabled', 'true'),
                ('MemoryReadDefault', 'false'),
                ('MemoryWriteDefault', 'false')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;
        await sql`
            INSERT INTO logs (
                user_id, token_id, channel_id, model_name, quota_cost, prompt_tokens, completion_tokens,
                cached_tokens, elapsed_ms, status_code, trace_id, external_user_id, external_workspace_id, external_feature_type
            )
            VALUES (
                ${user.id}, ${token.id}, ${channel.id}, 'gpt-4.1', 42, 100, 24,
                8, 320, 200, 'trace_runtime_smoke', 'external_runtime_user', ${WORKSPACE_ID}, 'chat'
            )
        `;
        await sql`
            INSERT INTO agent_memories (
                id, user_id, token_id, scope, kind, content, content_hash, confidence, metadata
            )
            VALUES (
                'mem_runtime_smoke', ${user.id}, ${token.id}, 'user', 'fact',
                'runtime smoke memory', 'runtime-smoke-memory-hash', '0.9000', '{}'::jsonb
            )
            ON CONFLICT (id) DO NOTHING
        `;
        await sql`
            INSERT INTO model_metadata (model_name, type, endpoint, display_name, tags)
            VALUES ('gpt-4.1', 'chat', '/v1/chat/completions', 'Runtime Smoke GPT-4.1', '["runtime-smoke"]'::jsonb)
            ON CONFLICT (model_name) DO UPDATE SET
                type = EXCLUDED.type,
                endpoint = EXCLUDED.endpoint,
                display_name = EXCLUDED.display_name,
                tags = EXCLUDED.tags,
                updated_at = NOW()
        `;
        await sql`
            INSERT INTO user_groups (key, name, description, allowed_models, status)
            VALUES ('runtime-smoke-group', 'Runtime Smoke Group', 'Runtime smoke group fixture', '["gpt-4.1"]'::jsonb, 1)
            ON CONFLICT (key) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                allowed_models = EXCLUDED.allowed_models,
                status = EXCLUDED.status,
                updated_at = NOW()
        `;
        await sql`
            INSERT INTO rate_limit_rules (name, rpm, rph, concurrent)
            VALUES ('Runtime Smoke Rate Limit', 120, 2400, 4)
        `;
        await sql`
            INSERT INTO packages (name, description, price, duration_days, models, is_public, added_by)
            VALUES ('Runtime Smoke Package', 'Runtime smoke package fixture', 9.99, 30, '["gpt-4.1"]'::jsonb, true, ${user.id})
        `;
        await sql`
            INSERT INTO redemptions (name, key, quota, count, status, created_by)
            VALUES ('Runtime Smoke Redemption', 'cdk-runtime-smoke', 1024, 3, 1, ${user.id})
            ON CONFLICT (key) DO UPDATE SET
                name = EXCLUDED.name,
                quota = EXCLUDED.quota,
                count = EXCLUDED.count,
                status = EXCLUDED.status,
                created_by = EXCLUDED.created_by
        `;
        await sql`
            INSERT INTO vendors (name, type, base_url, logo_url, description, config)
            VALUES ('Runtime Smoke Vendor', 1, 'https://vendor.runtime-smoke.invalid', '', 'Runtime smoke vendor fixture', '{}'::jsonb)
        `;
    } finally {
        await sql.close();
    }
}

async function readProcessOutput(proc: SpawnedProcess): Promise<string> {
    proc.kill();
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return [
        stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
        stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
    ].filter(Boolean).join('\n');
}

async function waitForGateway(proc: SpawnedProcess): Promise<void> {
    const deadline = Date.now() + 45_000;
    let lastError = '';
    while (Date.now() < deadline) {
        const exited = await Promise.race([
            proc.exited.then((exitCode) => exitCode),
            Bun.sleep(0).then(() => null),
        ]);
        if (exited !== null) {
            const output = await readProcessOutput(proc);
            throw new Error(`Gateway exited before readiness with code ${exited}\n${output}`);
        }
        try {
            const response = await fetch(`${gatewayUrl}/api/enterprise/health`);
            if (response.ok) return;
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await Bun.sleep(500);
    }
    const output = await readProcessOutput(proc);
    throw new Error(`Gateway did not become ready: ${lastError}\n${output}`);
}

async function apiRequest<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${gatewayUrl}/api/enterprise${path}`, {
        method: init.method ?? 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await response.json() as ApiEnvelope<T>;
    if (!response.ok || json.success === false) {
        throw new Error(json.message || `HTTP ${response.status} for ${path}`);
    }
    return json.data as T;
}

async function panelRequest<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${gatewayUrl}/api/admin${path}`, {
        method: init.method ?? 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await response.json() as unknown;
    if (!response.ok) {
        const message = typeof json === 'object' && json !== null && 'message' in json && typeof json.message === 'string'
            ? json.message
            : `HTTP ${response.status} for /api/admin${path}`;
        throw new Error(`${message} for /api/admin${path}`);
    }
    if (typeof json === 'object' && json !== null && 'success' in json && json.success === false) {
        const message = 'message' in json && typeof json.message === 'string'
            ? json.message
            : `Admin API returned success=false for ${path}`;
        throw new Error(`${message} for /api/admin${path}`);
    }
    return json as T;
}

async function seedEnterpriseControlPlane(token: string): Promise<void> {
    const install = await apiRequest<{ readonly instance: GatewayInstance }>('/install', token, {
        method: 'POST',
        body: {
            tenant_id: TENANT_ID,
            org_id: ORG_ID,
            project_id: PROJECT_ID,
            app_instance_id: APP_INSTANCE_ID,
            public_base_url: gatewayUrl,
            admin_base_url: `${gatewayUrl}/enterprise/`,
            database_url_secret_name: 'elygate/runtime-smoke/database-url',
            supauth_issuer_url: 'https://auth.runtime-smoke.local',
            supauth_jwks_url: 'https://auth.runtime-smoke.local/.well-known/jwks.json',
            supauth_audience: gatewayUrl,
        },
    });
    await apiRequest<GatewayInstance>(`/gateway-instances/${install.instance.id}`, token, {
        method: 'PUT',
        body: { status: 'active', entitlements_version: 2 },
    });
    await apiRequest<JsonObject>('/identity-policies', token, {
        method: 'POST',
        body: {
            name: 'Runtime Smoke Allow',
            target_kind: 'org',
            effect: 'allow',
            rules: { models: ['*'], actions: ['request'] },
        },
    });
    const denyPolicy = await apiRequest<{ readonly id: number }>('/identity-policies', token, {
        method: 'POST',
        body: {
            name: 'Runtime Smoke Deny Workspace',
            target_kind: 'external_workspace',
            target_id: 'workspace_blocked',
            effect: 'deny',
            rules: { models: ['gpt-4.1'], actions: ['request'] },
        },
    });
    const policyEvaluation = await apiRequest<{ readonly decision: string; readonly deny_policy_ids: readonly number[] }>('/policy-evaluations', token, {
        method: 'POST',
        body: { model: 'gpt-4.1', external_workspace_id: 'workspace_blocked' },
    });
    if (policyEvaluation.decision !== 'deny' || !policyEvaluation.deny_policy_ids.includes(denyPolicy.id)) {
        throw new Error('Policy evaluation did not apply deny-overrides');
    }

    const budget = await apiRequest<{ readonly id: number }>('/budgets', token, {
        method: 'POST',
        body: { subject_kind: 'org', period: 'monthly', limit_quota: 1000, used_quota: 100, alert_threshold_pct: 80 },
    });
    const budgetEvaluation = await apiRequest<{ readonly decision: string; readonly warning_budget_ids: readonly number[] }>('/budget-evaluations', token, {
        method: 'POST',
        body: { subject_kind: 'org', requested_quota: 750 },
    });
    if (budgetEvaluation.decision !== 'warn' || !budgetEvaluation.warning_budget_ids.includes(budget.id)) {
        throw new Error('Budget evaluation did not warn at threshold');
    }

    const auditExport = await apiRequest<{ readonly total: number; readonly content: string }>('/audit-events/export?action=budget.create', token);
    if (auditExport.total < 1 || !auditExport.content.includes('budget.create')) {
        throw new Error('Audit export did not include budget.create');
    }
}

async function loginPanel(username: string, password: string): Promise<string> {
    const response = await fetch(`${gatewayUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            password,
        }),
    });
    const json = await response.json() as LoginResponse;
    if (!response.ok || json.success === false || !json.token) {
        throw new Error(json.message || `Panel login failed for ${username} with HTTP ${response.status}`);
    }
    return json.token;
}

async function loginPanelAdmin(): Promise<string> {
    return loginPanel('admin', 'runtime-smoke-admin-password');
}

function requireId(value: number | string | undefined, label: string): number | string {
    if (typeof value === 'number' || typeof value === 'string') return value;
    throw new Error(`${label} did not return an id`);
}

function assertPanelRecord(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

async function waitForCondition(label: string, predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
        try {
            if (await predicate()) return;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await Bun.sleep(250);
    }
    throw new Error(`${label} did not become true before timeout${lastError ? `: ${lastError}` : ''}`);
}

function formatRows(label: string, rows: readonly JsonObject[]): string {
    return `${label}=${JSON.stringify(rows, null, 2)}`;
}

async function collectBasicGatewayDiagnostics(sql: Bun.SQL, traceId: string): Promise<string> {
    const exactLogs = await sql`
        SELECT id, model_name, prompt_tokens, completion_tokens, cached_tokens, status_code, trace_id, error_message, created_at
        FROM logs
        WHERE trace_id = ${traceId}
        ORDER BY id DESC
        LIMIT 5
    ` as JsonObject[];
    const recentLogs = await sql`
        SELECT l.id, l.model_name, l.prompt_tokens, l.completion_tokens, l.cached_tokens, l.status_code, l.trace_id, l.error_message, l.created_at
        FROM logs l
        JOIN tokens t ON t.id = l.token_id
        WHERE t.key = 'sk-runtime-smoke-key'
        ORDER BY l.id DESC
        LIMIT 8
    ` as JsonObject[];
    const budgets = await sql`
        SELECT id, subject_kind, limit_quota, used_quota, status, updated_at
        FROM enterprise_budgets
        WHERE tenant_id = ${TENANT_ID}
          AND org_id = ${ORG_ID}
          AND app_instance_id = ${APP_INSTANCE_ID}
        ORDER BY id DESC
        LIMIT 5
    ` as JsonObject[];
    const bossTables = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'pgboss_runtime_smoke'
        ORDER BY table_name
    ` as JsonObject[];

    let bossJobs: JsonObject[] = [];
    try {
        bossJobs = await sql`
            SELECT id, name, state::text AS state, retry_count, created_on, started_on, completed_on, data, output
            FROM "pgboss_runtime_smoke".job
            WHERE name = 'billing.flush'
            ORDER BY created_on DESC
            LIMIT 5
        ` as JsonObject[];
    } catch (error) {
        bossJobs = [{ error: error instanceof Error ? error.message : String(error) }];
    }

    return [
        formatRows('exact_logs', exactLogs),
        formatRows('recent_token_logs', recentLogs),
        formatRows('enterprise_budgets', budgets),
        formatRows('pgboss_tables', bossTables),
        formatRows('pgboss_billing_jobs', bossJobs),
    ].join('\n');
}

function unwrapPanelData<T>(payload: T | PanelDataEnvelope<T>): T {
    if (
        payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && 'success' in payload
        && 'data' in payload
    ) {
        return (payload as PanelDataEnvelope<T>).data;
    }
    return payload as T;
}

function responseCacheHash(model: string, messages: readonly JsonObject[]): string {
    const content = JSON.stringify({ model, messages });
    return new Bun.CryptoHasher('sha256').update(content).digest('hex');
}

function chatContent(json: JsonObject): string | undefined {
    return (json.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content;
}

async function gatewayChatCompletion(apiKey: string, body: JsonObject): Promise<JsonObject> {
    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const json = await response.json() as JsonObject;
    if (!response.ok) {
        throw new Error(`Basic gateway chat completion failed: HTTP ${response.status} ${JSON.stringify(json)}`);
    }
    return json;
}

async function verifyBasicGatewayDataPlane(): Promise<void> {
    console.log('[enterprise-runtime-smoke] verifying basic gateway data-plane');
    const traceId = `trace_basic_runtime_${Date.now()}`;

    const modelsResponse = await fetch(`${gatewayUrl}/v1/models`, {
        headers: { Authorization: 'Bearer sk-runtime-smoke-key' },
    });
    const modelsJson = await modelsResponse.json() as { readonly data?: readonly { readonly id?: string }[]; readonly error?: unknown };
    if (!modelsResponse.ok || !modelsJson.data?.some((model) => model.id === 'gpt-4.1')) {
        throw new Error(`Basic gateway /v1/models did not expose gpt-4.1: HTTP ${modelsResponse.status}`);
    }

    const json = await gatewayChatCompletion('sk-runtime-smoke-key', {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Say runtime smoke.' }],
        max_tokens: 8,
        trace_id: traceId,
        external_workspace_id: WORKSPACE_ID,
        external_feature_type: 'chat',
    });
    const content = chatContent(json);
    if (content !== 'runtime smoke completion from mock upstream') {
        throw new Error(`Basic gateway chat completion returned unexpected content: ${content}`);
    }

    const upstreamRequest = mockUpstreamRequests.find((item) => item.traceId === traceId);
    if (!upstreamRequest) {
        throw new Error('Mock OpenAI upstream did not receive the routed chat completion request');
    }
    if (upstreamRequest.authorization !== 'Bearer sk-runtime-smoke-provider') {
        throw new Error(`Mock OpenAI upstream received wrong Authorization header: ${upstreamRequest.authorization}`);
    }
    if (upstreamRequest.model !== 'gpt-4.1') {
        throw new Error(`Mock OpenAI upstream received wrong model: ${upstreamRequest.model}`);
    }

    const memoryTraceId = `${traceId}_memory`;
    const memoryJson = await gatewayChatCompletion('sk-runtime-smoke-key', {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Use my runtime memory.' }],
        max_tokens: 8,
        memory: 'read',
        trace_id: memoryTraceId,
    });
    if (chatContent(memoryJson) !== 'runtime smoke completion from mock upstream') {
        throw new Error('Basic gateway memory request returned unexpected content');
    }
    const memoryUpstreamRequest = mockUpstreamRequests.find((item) => item.traceId === memoryTraceId);
    const injectedMemory = memoryUpstreamRequest?.messages?.some((message) =>
        message.role === 'system' && String(message.content || '').includes('runtime smoke memory')
    );
    if (!injectedMemory) {
        throw new Error('Basic gateway Memory did not inject seeded user memory into the upstream request');
    }

    const limitedFirst = await fetch(`${gatewayUrl}/v1/models`, {
        headers: { Authorization: 'Bearer sk-runtime-smoke-limited-key' },
    });
    if (!limitedFirst.ok) {
        throw new Error(`Basic gateway limited key first request failed unexpectedly: HTTP ${limitedFirst.status}`);
    }
    const limitedSecond = await fetch(`${gatewayUrl}/v1/models`, {
        headers: { Authorization: 'Bearer sk-runtime-smoke-limited-key' },
    });
    if (limitedSecond.status !== 429) {
        const body = await limitedSecond.text().catch(() => '');
        throw new Error(`Basic gateway token rate limit did not return HTTP 429 on second request: HTTP ${limitedSecond.status} ${body}`);
    }

    const sql = new Bun.SQL(databaseUrl);
    try {
        try {
            await waitForCondition('basic gateway usage log', async () => {
                const rows = await sql`
                    SELECT model_name, prompt_tokens, completion_tokens, cached_tokens, status_code, trace_id
                    FROM logs
                    WHERE trace_id = ${traceId}
                    ORDER BY id DESC
                    LIMIT 1
                ` as Array<{
                    model_name: string;
                    prompt_tokens: number;
                    completion_tokens: number;
                    cached_tokens: number;
                    status_code: number;
                    trace_id: string;
                }>;
                const [row] = rows;
                return row?.model_name === 'gpt-4.1'
                    && Number(row.prompt_tokens) === 7
                    && Number(row.completion_tokens) === 5
                    && Number(row.cached_tokens) === 2
                    && Number(row.status_code) === 200;
            }, 30_000);

            await waitForCondition('enterprise runtime budget consumption', async () => {
                const rows = await sql`
                    SELECT used_quota
                    FROM enterprise_budgets
                    WHERE tenant_id = ${TENANT_ID}
                      AND org_id = ${ORG_ID}
                      AND app_instance_id = ${APP_INSTANCE_ID}
                      AND subject_kind = 'org'
                    ORDER BY id DESC
                    LIMIT 1
                ` as Array<{ used_quota: string | number }>;
                const [row] = rows;
                return Number(row?.used_quota ?? 0) > 100;
            }, 30_000);

            const cacheMessages = [{ role: 'user', content: `Cache runtime smoke ${Date.now()}` }];
            const cacheHash = responseCacheHash('gpt-4.1', cacheMessages);
            const cacheTraceId1 = `${traceId}_cache_1`;
            const cacheTraceId2 = `${traceId}_cache_2`;
            const upstreamCountBeforeCache = mockUpstreamRequests.length;
            const cacheFirstJson = await gatewayChatCompletion('sk-runtime-smoke-key', {
                model: 'gpt-4.1',
                messages: cacheMessages,
                max_tokens: 8,
                trace_id: cacheTraceId1,
            });
            if (chatContent(cacheFirstJson) !== 'runtime smoke completion from mock upstream') {
                throw new Error('Basic gateway response cache first request returned unexpected content');
            }
            const upstreamCountAfterFirstCache = mockUpstreamRequests.length;
            if (upstreamCountAfterFirstCache !== upstreamCountBeforeCache + 1) {
                throw new Error('Basic gateway response cache first request did not call upstream exactly once');
            }
            await waitForCondition('basic gateway response cache row', async () => {
                const rows = await sql`
                    SELECT hash
                    FROM response_cache
                    WHERE hash = ${cacheHash}
                    LIMIT 1
                ` as Array<{ hash: string }>;
                return rows.length === 1;
            }, 30_000);

            const cacheSecondJson = await gatewayChatCompletion('sk-runtime-smoke-key', {
                model: 'gpt-4.1',
                messages: cacheMessages,
                max_tokens: 8,
                trace_id: cacheTraceId2,
            });
            if (chatContent(cacheSecondJson) !== 'runtime smoke completion from mock upstream') {
                throw new Error('Basic gateway response cache hit returned unexpected content');
            }
            if (mockUpstreamRequests.length !== upstreamCountAfterFirstCache) {
                throw new Error('Basic gateway response cache hit called upstream unexpectedly');
            }
            await waitForCondition('basic gateway response cache hit log', async () => {
                const rows = await sql`
                    SELECT channel_id, model_name, status_code, trace_id
                    FROM logs
                    WHERE trace_id = ${cacheTraceId2}
                    ORDER BY id DESC
                    LIMIT 1
                ` as Array<{
                    channel_id: number;
                    model_name: string;
                    status_code: number;
                    trace_id: string;
                }>;
                const [row] = rows;
                return Number(row?.channel_id ?? 0) === -1
                    && row?.model_name === 'gpt-4.1'
                    && Number(row.status_code) === 200;
            }, 30_000);
        } catch (error) {
            const diagnostics = await collectBasicGatewayDiagnostics(sql, traceId);
            throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`);
        }
    } finally {
        await sql.close();
    }

    console.log('[enterprise-runtime-smoke] basic gateway data-plane ok');
}

async function verifyPanelApiFunctions(token: string): Promise<void> {
    console.log('[enterprise-runtime-smoke] verifying panel admin API functions');
    const channelName = 'Runtime Smoke Panel CRUD';
    const updatedChannelName = 'Runtime Smoke Panel CRUD Updated';
    let channelId: number | string | null = null;
    let tokenId: number | string | null = null;
    let modelMetaId: number | string | null = null;
    let userId: number | string | null = null;
    let userGroupKey: string | null = null;
    let rateLimitId: number | string | null = null;
    let packageId: number | string | null = null;
    let redemptionId: number | string | null = null;
    let vendorId: number | string | null = null;
    let selfTokenId: number | string | null = null;
    let consumerPanelToken: string | null = null;

    try {
        const channelsBefore = await panelRequest<readonly PanelChannel[]>('/channels', token);
        assertPanelRecord(
            channelsBefore.some((channel) => channel.name === 'Runtime Smoke OpenAI' && channel.key === 'sk-runtime-smoke-provider'),
            'Panel channels list did not expose seeded provider channel',
        );

        const createdChannel = await panelRequest<PanelChannel>('/channels', token, {
            method: 'POST',
            body: {
                name: channelName,
                type: 1,
                key: 'sk-panel-smoke-provider',
                baseUrl: 'https://example.invalid/v1',
                models: ['gpt-4.1-mini'],
                priority: 3,
                weight: 2,
                priceRatio: 1,
                endpointType: 'chat',
            },
        });
        channelId = requireId(createdChannel.id, 'created channel');

        const updatedChannel = await panelRequest<PanelChannel>(`/channels/${channelId}`, token, {
            method: 'PUT',
            body: {
                name: updatedChannelName,
                status: 3,
                models: ['gpt-4.1-mini', 'gpt-4.1'],
            },
        });
        assertPanelRecord(updatedChannel.name === updatedChannelName, 'Panel channel update did not persist name');
        assertPanelRecord(updatedChannel.status === 3, 'Panel channel update did not persist status');

        const channelsAfterUpdate = await panelRequest<readonly PanelChannel[]>('/channels', token);
        assertPanelRecord(
            channelsAfterUpdate.some((channel) => channel.id === channelId && channel.name === updatedChannelName),
            'Panel channels list did not include updated channel',
        );

        await panelRequest<{ readonly success: boolean }>(`/channels/${channelId}`, token, { method: 'DELETE' });
        const channelsAfterDelete = await panelRequest<readonly PanelChannel[]>('/channels', token);
        assertPanelRecord(
            !channelsAfterDelete.some((channel) => channel.id === channelId),
            'Panel channel delete did not remove the channel',
        );
        channelId = null;

        const createdToken = await panelRequest<PanelToken>('/tokens', token, {
            method: 'POST',
            body: {
                name: 'Runtime Smoke Panel Token',
                remainQuota: 2048,
                models: ['gpt-4.1'],
                unlimitedQuota: false,
                modelLimitsEnabled: true,
            },
        });
        tokenId = requireId(createdToken.id, 'created token');

        const updatedToken = await panelRequest<PanelToken>(`/tokens/${tokenId}`, token, {
            method: 'PUT',
            body: {
                name: 'Runtime Smoke Panel Token Updated',
                rateLimit: 60,
                status: 1,
            },
        });
        assertPanelRecord(updatedToken.name === 'Runtime Smoke Panel Token Updated', 'Panel token update did not persist name');
        assertPanelRecord(updatedToken.rateLimit === 60, 'Panel token update did not persist rate limit');

        const regenerated = await panelRequest<{ readonly success: boolean; readonly token: PanelToken }>(`/tokens/${tokenId}/regenerate`, token, {
            method: 'POST',
        });
        assertPanelRecord(regenerated.success === true && regenerated.token.key?.startsWith('sk-'), 'Panel token regenerate did not return a new key');

        await panelRequest<{ readonly success: boolean }>(`/tokens/${tokenId}`, token, { method: 'DELETE' });
        const tokensAfterDelete = await panelRequest<readonly PanelToken[]>('/tokens', token);
        assertPanelRecord(
            !tokensAfterDelete.some((item) => item.id === tokenId),
            'Panel token delete did not remove the token',
        );
        tokenId = null;

        await panelRequest<{ readonly success: boolean }>('/options', token, {
            method: 'PUT',
            body: { PanelRuntimeSmokeOption: 'ok' },
        });
        const options = await panelRequest<Record<string, string>>('/options', token);
        assertPanelRecord(options.PanelRuntimeSmokeOption === 'ok', 'Panel settings update did not persist');

        const logs = await panelRequest<PanelLogList>('/logs?page=1&limit=5', token);
        assertPanelRecord(logs.total >= 1, 'Panel logs list did not report seeded usage logs');
        assertPanelRecord(
            logs.data.some((log) => log.modelName === 'gpt-4.1' && log.traceId === 'trace_runtime_smoke'),
            'Panel logs list did not include seeded runtime usage log',
        );

        const modelStatuses = await panelRequest<readonly PanelModelStatus[]>('/models', token);
        assertPanelRecord(
            modelStatuses.some((model) => model.id === 'gpt-4.1' && model.status === 'online'),
            'Panel model status did not expose seeded routed model',
        );

        const createdModelMeta = await panelRequest<PanelModelMetadata>('/models-meta', token, {
            method: 'POST',
            body: {
                modelName: 'runtime-smoke-panel-model',
                type: 'chat',
                endpoint: '/v1/chat/completions',
                displayName: 'Runtime Smoke Panel Model',
                tags: ['runtime-smoke'],
            },
        });
        modelMetaId = requireId(createdModelMeta.id, 'created model metadata');

        const updatedModelMeta = await panelRequest<PanelModelMetadata>(`/models-meta/${modelMetaId}`, token, {
            method: 'PUT',
            body: {
                displayName: 'Runtime Smoke Panel Model Updated',
                tags: ['runtime-smoke', 'updated'],
            },
        });
        assertPanelRecord(updatedModelMeta.displayName === 'Runtime Smoke Panel Model Updated', 'Panel model metadata update did not persist display name');

        const modelMetaAfterUpdate = await panelRequest<readonly PanelModelMetadata[]>('/models-meta', token);
        assertPanelRecord(
            modelMetaAfterUpdate.some((model) => model.id === modelMetaId && model.displayName === 'Runtime Smoke Panel Model Updated'),
            'Panel model metadata list did not include updated model metadata',
        );

        await panelRequest<{ readonly success: boolean }>(`/models-meta/${modelMetaId}`, token, { method: 'DELETE' });
        const modelMetaAfterDelete = await panelRequest<readonly PanelModelMetadata[]>('/models-meta', token);
        assertPanelRecord(
            !modelMetaAfterDelete.some((model) => model.id === modelMetaId),
            'Panel model metadata delete did not remove the model metadata',
        );
        modelMetaId = null;

        const performanceStats = await panelRequest<PanelSuccessData<{ readonly database?: { readonly totalLogs?: number } }>>('/performance/stats', token);
        assertPanelRecord(performanceStats.success === true, 'Panel performance stats did not return success=true');
        assertPanelRecord((performanceStats.data.database?.totalLogs ?? 0) >= 1, 'Panel performance stats did not count seeded logs');

        await panelRequest<{ readonly success: boolean }>('/performance/ratio-config', token, {
            method: 'PUT',
            body: {
                modelRatio: { 'runtime-smoke-ratio-model': 2.5 },
                completionRatio: { 'runtime-smoke-ratio-model': 1.2 },
                groupRatio: { runtime: 0.8 },
                fixedCostModels: { 'runtime-smoke-fixed-model': 7 },
            },
        });
        const ratioConfig = await panelRequest<PanelSuccessData<PanelRatioConfig>>('/performance/ratio-config', token);
        assertPanelRecord(ratioConfig.data.modelRatio?.['runtime-smoke-ratio-model'] === 2.5, 'Panel ratio config update did not persist model ratio');

        await panelRequest<{ readonly success: boolean }>('/content', token, {
            method: 'PUT',
            body: {
                Notice: 'Runtime Smoke Notice',
                SEO_Title: 'Runtime Smoke SEO',
            },
        });
        const content = await panelRequest<PanelSuccessData<Record<string, string>>>('/content', token);
        assertPanelRecord(content.data.Notice === 'Runtime Smoke Notice', 'Panel content update did not persist notice');
        assertPanelRecord(content.data.SEO_Title === 'Runtime Smoke SEO', 'Panel content update did not persist SEO title');

        const memoryStats = await panelRequest<PanelSuccessData<PanelMemoryStats>>('/memory/stats', token);
        assertPanelRecord(memoryStats.data.total >= 1 && memoryStats.data.active >= 1, 'Panel memory stats did not count seeded memory');
        const memories = await panelRequest<PanelMemoryList>('/memory?limit=10&query=runtime%20smoke%20memory', token);
        assertPanelRecord(
            memories.total >= 1 && memories.data.some((memory) => memory.content === 'runtime smoke memory'),
            'Panel memory list did not include seeded runtime memory',
        );

        const userName = `runtime_smoke_panel_user_${Date.now()}`;
        const userPassword = 'runtime-smoke-user-password';
        const createdUser = await panelRequest<PanelUser>('/users', token, {
            method: 'POST',
            body: {
                username: userName,
                password: userPassword,
                role: 1,
                quota: 1000,
            },
        });
        userId = requireId(createdUser.id, 'created user');
        const updatedUser = await panelRequest<PanelUser>(`/users/${userId}`, token, {
            method: 'PUT',
            body: { quota: 2000, status: 1 },
        });
        assertPanelRecord(updatedUser.quota === 2000, 'Panel user update did not persist quota');
        const usersAfterUpdate = await panelRequest<readonly PanelUser[]>('/users', token);
        assertPanelRecord(
            usersAfterUpdate.some((userRow) => userRow.id === userId && userRow.username === userName),
            'Panel users list did not include created runtime user',
        );

        const consumerToken = await loginPanel(userName, userPassword);
        consumerPanelToken = consumerToken;
        const selfInfo = await panelRequest<PanelDataEnvelope<PanelUser>>('/self/info', consumerToken);
        assertPanelRecord(selfInfo.data.username === userName, 'Panel self info did not return the authenticated user');
        const selfTokensBefore = await panelRequest<PanelDataEnvelope<readonly PanelToken[]>>('/self/tokens', consumerToken);
        assertPanelRecord(selfTokensBefore.success === true, 'Panel self tokens list did not return success=true');
        const selfCreatedToken = await panelRequest<PanelDataEnvelope<PanelToken>>('/self/tokens', consumerToken, {
            method: 'POST',
            body: { name: 'Runtime Smoke Self Token', models: ['gpt-4.1'], rateLimit: 30 },
        });
        selfTokenId = requireId(selfCreatedToken.data.id, 'created self token');
        const selfTokensAfterCreate = await panelRequest<PanelDataEnvelope<readonly PanelToken[]>>('/self/tokens', consumerToken);
        assertPanelRecord(
            selfTokensAfterCreate.data.some((item) => item.id === selfTokenId && item.name === 'Runtime Smoke Self Token'),
            'Panel self tokens list did not include created self token',
        );
        await panelRequest<{ readonly success: boolean }>(`/self/tokens/${selfTokenId}`, consumerToken, { method: 'DELETE' });
        selfTokenId = null;

        userGroupKey = `runtime-smoke-group-${Date.now()}`;
        const createdGroup = await panelRequest<PanelUserGroup>('/user-groups', token, {
            method: 'POST',
            body: {
                key: userGroupKey,
                name: 'Runtime Smoke Panel Group',
                description: 'Runtime smoke panel CRUD group',
                allowedModels: ['gpt-4.1'],
                status: 1,
            },
        });
        assertPanelRecord(createdGroup.key === userGroupKey, 'Panel user group create did not return key');
        const updatedGroup = await panelRequest<PanelUserGroup>(`/user-groups/${userGroupKey}`, token, {
            method: 'PUT',
            body: { name: 'Runtime Smoke Panel Group Updated', status: 2 },
        });
        assertPanelRecord(updatedGroup.name === 'Runtime Smoke Panel Group Updated', 'Panel user group update did not persist name');
        const groupsAfterUpdate = await panelRequest<readonly PanelUserGroup[]>('/user-groups', token);
        assertPanelRecord(
            groupsAfterUpdate.some((group) => group.key === userGroupKey && group.name === 'Runtime Smoke Panel Group Updated'),
            'Panel user groups list did not include updated group',
        );
        await panelRequest<{ readonly success: boolean }>(`/user-groups/${userGroupKey}`, token, { method: 'DELETE' });
        userGroupKey = null;

        const createdRateLimitEnvelope = await panelRequest<PanelDataEnvelope<PanelRateLimit>>('/rate-limits', token, {
            method: 'POST',
            body: { name: 'Runtime Smoke Panel Rate Limit', rpm: 90, rph: 900, concurrent: 3 },
        });
        const createdRateLimit = unwrapPanelData(createdRateLimitEnvelope);
        rateLimitId = requireId(createdRateLimit.id, 'created rate limit');
        const updatedRateLimit = unwrapPanelData(await panelRequest<PanelDataEnvelope<PanelRateLimit>>(`/rate-limits/${rateLimitId}`, token, {
            method: 'PUT',
            body: { name: 'Runtime Smoke Panel Rate Limit Updated', rpm: 120 },
        }));
        assertPanelRecord(updatedRateLimit.rpm === 120, 'Panel rate limit update did not persist rpm');
        const rateLimitsAfterUpdate = await panelRequest<readonly PanelRateLimit[]>('/rate-limits', token);
        assertPanelRecord(
            rateLimitsAfterUpdate.some((rule) => rule.id === rateLimitId && rule.name === 'Runtime Smoke Panel Rate Limit Updated'),
            'Panel rate limits list did not include updated rule',
        );
        await panelRequest<{ readonly success: boolean }>(`/rate-limits/${rateLimitId}`, token, { method: 'DELETE' });
        rateLimitId = null;

        const createdPackage = unwrapPanelData(await panelRequest<PanelDataEnvelope<PanelPackage>>('/packages', token, {
            method: 'POST',
            body: {
                name: 'Runtime Smoke Panel Package',
                price: 19.99,
                durationDays: 15,
                models: ['gpt-4.1'],
                isPublic: true,
            },
        }));
        packageId = requireId(createdPackage.id, 'created package');
        const updatedPackage = unwrapPanelData(await panelRequest<PanelDataEnvelope<PanelPackage>>(`/packages/${packageId}`, token, {
            method: 'PUT',
            body: { name: 'Runtime Smoke Panel Package Updated', durationDays: 45 },
        }));
        assertPanelRecord(updatedPackage.name === 'Runtime Smoke Panel Package Updated', 'Panel package update did not persist name');
        const packagesAfterUpdate = await panelRequest<readonly PanelPackage[]>('/packages', token);
        assertPanelRecord(
            packagesAfterUpdate.some((pkg) => pkg.id === packageId && pkg.name === 'Runtime Smoke Panel Package Updated'),
            'Panel packages list did not include updated package',
        );
        await panelRequest<{ readonly success: boolean }>(`/packages/${packageId}`, token, { method: 'DELETE' });
        packageId = null;

        const createdRedemption = await panelRequest<PanelRedemption>('/redemptions', token, {
            method: 'POST',
            body: {
                name: 'Runtime Smoke Panel Redemption',
                key: `cdk-runtime-smoke-panel-${Date.now()}`,
                quota: 333,
                count: 2,
            },
        });
        redemptionId = requireId(createdRedemption.id, 'created redemption');
        const updatedRedemption = await panelRequest<PanelRedemption>(`/redemptions/${redemptionId}`, token, {
            method: 'PUT',
            body: { name: 'Runtime Smoke Panel Redemption Updated', quota: 444 },
        });
        assertPanelRecord(updatedRedemption.name === 'Runtime Smoke Panel Redemption Updated', 'Panel redemption update did not persist name');
        const redemptionsAfterUpdate = await panelRequest<readonly PanelRedemption[]>('/redemptions', token);
        assertPanelRecord(
            redemptionsAfterUpdate.some((redemption) => redemption.id === redemptionId && redemption.name === 'Runtime Smoke Panel Redemption Updated'),
            'Panel redemptions list did not include updated redemption',
        );
        await panelRequest<{ readonly success: boolean }>(`/redemptions/${redemptionId}`, token, { method: 'DELETE' });
        redemptionId = null;

        const createdVendor = await panelRequest<PanelVendor>('/vendors', token, {
            method: 'POST',
            body: {
                name: 'Runtime Smoke Panel Vendor',
                type: 1,
                baseUrl: 'https://panel-vendor.runtime-smoke.invalid',
                description: 'Runtime smoke panel CRUD vendor',
            },
        });
        vendorId = requireId(createdVendor.id, 'created vendor');
        const updatedVendor = await panelRequest<PanelVendor>(`/vendors/${vendorId}`, token, {
            method: 'PUT',
            body: { name: 'Runtime Smoke Panel Vendor Updated', type: 2 },
        });
        assertPanelRecord(updatedVendor.name === 'Runtime Smoke Panel Vendor Updated', 'Panel vendor update did not persist name');
        const vendorsAfterUpdate = await panelRequest<readonly PanelVendor[]>('/vendors', token);
        assertPanelRecord(
            vendorsAfterUpdate.some((vendor) => vendor.id === vendorId && vendor.name === 'Runtime Smoke Panel Vendor Updated'),
            'Panel vendors list did not include updated vendor',
        );
        await panelRequest<{ readonly success: boolean }>(`/vendors/${vendorId}`, token, { method: 'DELETE' });
        vendorId = null;

        const backupStatus = await panelRequest<PanelSuccessData<{ readonly stats?: Record<string, number> }>>('/data/backup/status', token);
        assertPanelRecord((backupStatus.data.stats?.users ?? 0) >= 1, 'Panel backup status did not count users');
        const exportedConfig = await panelRequest<{ readonly channels: readonly JsonObject[]; readonly userGroups: readonly JsonObject[]; readonly vendors: readonly JsonObject[] }>('/data/export', token);
        assertPanelRecord(
            exportedConfig.channels.some((channel) => channel.name === 'Runtime Smoke OpenAI'),
            'Panel data export did not include seeded channel',
        );
        assertPanelRecord(exportedConfig.userGroups.some((group) => group.key === 'runtime-smoke-group'), 'Panel data export did not include seeded user group');

        console.log('[enterprise-runtime-smoke] panel admin API functions ok');
    } finally {
        if (selfTokenId !== null) {
            const cleanupToken = consumerPanelToken ?? token;
            await panelRequest<{ readonly success: boolean }>(`/self/tokens/${selfTokenId}`, cleanupToken, { method: 'DELETE' }).catch(() => {});
        }
        if (vendorId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/vendors/${vendorId}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (redemptionId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/redemptions/${redemptionId}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (packageId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/packages/${packageId}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (rateLimitId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/rate-limits/${rateLimitId}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (userGroupKey !== null) {
            await panelRequest<{ readonly success: boolean }>(`/user-groups/${userGroupKey}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (userId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/users/${userId}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (modelMetaId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/models-meta/${modelMetaId}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (tokenId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/tokens/${tokenId}`, token, { method: 'DELETE' }).catch(() => {});
        }
        if (channelId !== null) {
            await panelRequest<{ readonly success: boolean }>(`/channels/${channelId}`, token, { method: 'DELETE' }).catch(() => {});
        }
    }
}

async function waitForText(page: Page, texts: readonly string[]): Promise<void> {
    try {
        await page.waitForFunction((expectedTexts: readonly string[]) => {
            const bodyText = document.body?.innerText || '';
            return expectedTexts.every((text) => bodyText.includes(text));
        }, texts, { timeout: 15_000 });
    } catch (error) {
        const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        throw new Error([
            error instanceof Error ? error.message : String(error),
            `url=${page.url()}`,
            `expected=${texts.join(' | ')}`,
            `body=${bodyText.slice(0, 1000)}`,
        ].join('\n'));
    }
}

async function assertNoErrorText(page: Page): Promise<void> {
    const bodyText = await page.locator('body').innerText({ timeout: 5_000 });
    const forbidden = ['Gateway API keys are only valid', 'insufficient_scope', 'HTTP 401', 'HTTP 403', 'Cannot find module'];
    const found = forbidden.find((item) => bodyText.includes(item));
    if (found) throw new Error(`Page contains error text: ${found}`);
}

async function verifyEnterprisePages(token: string): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    const consoleErrors: string[] = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        context.setDefaultTimeout(15_000);
        context.setDefaultNavigationTimeout(20_000);
        await context.addInitScript((supauthToken: string) => {
            localStorage.setItem('supauth_token', supauthToken);
        }, token);
        const page = await context.newPage();
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(error.message));
        page.on('response', (response) => {
            if (response.url().includes('/api/enterprise') && response.status() >= 400) {
                consoleErrors.push(`${response.status()} ${response.url()}`);
            }
        });

        const pages: ReadonlyArray<{ readonly path: string; readonly texts: readonly string[] }> = [
            { path: 'enterprise-overview', texts: ['Elygate Enterprise', TENANT_ID, '网关实例'] },
            { path: 'gateway-instances', texts: ['网关实例', '卸载回调', APP_INSTANCE_ID] },
            { path: 'gateway-resources', texts: ['网关资源', 'Runtime Smoke OpenAI', 'gpt-4.1'] },
            { path: 'identity-and-policy', texts: ['身份与策略', '策略评估', 'Runtime Smoke Deny Workspace'] },
            { path: 'usage-and-budget', texts: ['用量与预算', '用量归因', '预算评估'] },
            { path: 'audit-events', texts: ['审计事件', 'budget.create'] },
        ];

        for (const item of pages) {
            console.log(`[enterprise-runtime-smoke] opening ${item.path}`);
            await page.goto(`${gatewayUrl}/enterprise/#/${item.path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
            await waitForText(page, item.texts);
            if (item.path === 'usage-and-budget') {
                await page.getByRole('tab', { name: /Workspace/ }).click();
                await waitForText(page, [WORKSPACE_ID]);
            }
            await assertNoErrorText(page);
            console.log(`[enterprise-runtime-smoke] page ok ${item.path}`);
        }

        if (consoleErrors.length > 0) {
            throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
        }
    } finally {
        await browser.close();
    }
}

async function verifyPanelPages(token: string): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    const consoleErrors: string[] = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        context.setDefaultTimeout(15_000);
        context.setDefaultNavigationTimeout(20_000);
        await context.addInitScript((adminToken: string) => {
            localStorage.setItem('auth_token', adminToken);
        }, token);
        const page = await context.newPage();
        page.on('console', (message) => {
            if (message.type() === 'error') {
                const location = message.location();
                consoleErrors.push(`${message.text()} @ ${location.url}:${location.lineNumber}:${location.columnNumber}`);
            }
        });
        page.on('pageerror', (error) => consoleErrors.push(error.stack || error.message));
        page.on('response', (response) => {
            const url = response.url();
            if (
                response.status() >= 400
                && (
                    url.startsWith(`${gatewayUrl}/api/`)
                    || url.startsWith(`${gatewayUrl}/v1/`)
                )
                && !url.startsWith(`${gatewayUrl}/api/enterprise`)
            ) {
                consoleErrors.push(`${response.status()} ${response.url()}`);
            }
        });

        const pages: ReadonlyArray<{ readonly path: string; readonly texts: readonly string[] }> = [
            { path: '', texts: ['仪表盘', 'Elygate 面板'] },
            { path: 'channels', texts: ['渠道', 'Runtime Smoke OpenAI'] },
            { path: 'users', texts: ['用户', 'runtime_smoke_user'] },
            { path: 'tokens', texts: ['令牌', 'Runtime Smoke Key'] },
            { path: 'user-groups', texts: ['分组', 'Runtime Smoke Group'] },
            { path: 'packages', texts: ['套餐', 'Runtime Smoke Package'] },
            { path: 'redemptions', texts: ['兑换码', 'Runtime Smoke Redemption'] },
            { path: 'vendors', texts: ['供应商', 'Runtime Smoke Vendor'] },
            { path: 'rate-limits', texts: ['限流策略', 'Runtime Smoke Rate Limit'] },
            { path: 'models', texts: ['模型状态', 'gpt-4.1'] },
            { path: 'models-meta', texts: ['模型管理', 'gpt-4.1'] },
            { path: 'logs', texts: ['日志', 'gpt-4.1', 'Runtime Smoke OpenAI'] },
            { path: 'pricing-editor', texts: ['倍率管理', 'runtime-smoke-ratio-model'] },
            { path: 'content-management', texts: ['内容管理', '系统公告'] },
            { path: 'performance-monitor', texts: ['性能监控', '数据库概况'] },
            { path: 'memory-management', texts: ['Agent Memory', 'runtime smoke memory'] },
            { path: 'playground', texts: ['API 测试台', 'gpt-4.1'] },
            { path: 'feature-console', texts: ['新增功能', '模型部署'] },
            { path: 'system-options', texts: ['系统设置'] },
        ];

        for (const item of pages) {
            const url = item.path ? `${gatewayUrl}/#/${item.path}` : `${gatewayUrl}/`;
            const errorOffset = consoleErrors.length;
            console.log(`[enterprise-runtime-smoke] opening panel ${item.path || 'dashboard'}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
            await waitForText(page, item.texts);
            await assertNoErrorText(page);
            const pageErrors = consoleErrors.slice(errorOffset);
            if (pageErrors.length > 0) {
                throw new Error(`Panel console errors on ${item.path || 'dashboard'}:\n${pageErrors.join('\n')}`);
            }
            console.log(`[enterprise-runtime-smoke] panel page ok ${item.path || 'dashboard'}`);
        }

        if (consoleErrors.length > 0) {
            throw new Error(`Panel console errors:\n${consoleErrors.join('\n')}`);
        }
    } finally {
        await browser.close();
    }
}

async function main(): Promise<void> {
    const postgres = await startPostgres();
    const explicitGatewayPort = parsePort(process.env.ENTERPRISE_SMOKE_GATEWAY_PORT, 'ENTERPRISE_SMOKE_GATEWAY_PORT');
    databaseUrl = postgres.databaseUrl;
    const mockUpstreamPort = await findFreePort();
    mockUpstreamUrl = `http://127.0.0.1:${mockUpstreamPort}`;
    const mockUpstream = startMockOpenAIUpstream(mockUpstreamPort);
    gatewayPort = explicitGatewayPort ?? await findFreePort();
    gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
    console.log(`[enterprise-runtime-smoke] started temp PostgreSQL on ${postgres.port}`);
    console.log(`[enterprise-runtime-smoke] started mock OpenAI upstream on ${mockUpstreamPort}`);
    let gateway: SpawnedProcess | null = null;
    const env = runtimeEnv();
    try {
        console.log('[enterprise-runtime-smoke] building panel and enterprise console');
        await run('bun', ['--cwd', 'apps/admin', 'build'], { env });
        await run('bun', ['--cwd', 'apps/enterprise-console', 'build'], { env });
        console.log('[enterprise-runtime-smoke] bootstrapping database');
        await run('bun', ['--cwd', 'apps/gateway', 'src/enterprise/dbSmoke.ts'], { env });
        await seedCoreGatewayData();

        await runGatewayWithRetries({
            explicitPort: explicitGatewayPort,
            initialPort: gatewayPort,
            allocatePort: findFreePort,
            isRetryableError: isAddressInUseError,
            runAttempt: async (port) => {
                gatewayPort = port;
                gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
                const token = createSupAuthToken();
                const gatewayEnv = runtimeEnv();
                console.log(`[enterprise-runtime-smoke] starting gateway on ${gatewayPort}`);
                gateway = Bun.spawn(['bun', '--cwd', 'apps/gateway', 'src/index.ts'], {
                    env: { ...process.env, ...gatewayEnv },
                    stdout: 'pipe',
                    stderr: 'pipe',
                });
                await waitForGateway(gateway);
                const panelToken = await loginPanelAdmin();
                await seedEnterpriseControlPlane(token);
                await verifyBasicGatewayDataPlane();
                await verifyPanelApiFunctions(panelToken);
                await verifyPanelPages(panelToken);
                await verifyEnterprisePages(token);
                console.log('[enterprise-runtime-smoke] ok');
            },
            cleanupAttempt: () => {
                if (gateway) {
                    gateway.kill();
                    gateway = null;
                }
            },
        });
    } finally {
        if (gateway) gateway.kill();
        mockUpstream.stop(true);
        await stopPostgres(postgres.dir);
    }
}

if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        console.error(`[enterprise-runtime-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
