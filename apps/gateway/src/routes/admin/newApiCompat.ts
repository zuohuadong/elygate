import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { channels, logs, modelMetadata, options, tokens, vendors } from '@elygate/db/schema';
import { adminGuard, authPlugin } from '../../middleware/auth';
import { memoryCache } from '../../services/cache';
import { encryptChannelKeys, decryptChannelKeys, getChannelKeys } from '../../services/encryption';
import { createCodexOAuthStartUrl, exchangeCodexOAuthCode, refreshCodexToken, getCodexUsage, isCodexOAuthConfigured } from '../../services/codexOAuth';
import { optionCache } from '../../services/optionCache';
import { getProviderHandler } from '../../providers';
import { ChannelType } from '../../types';
import { buildModelsUrl } from '../../utils/url';
import { assertSafeExternalUrl } from '../../utils/safeExternalUrl';
import { and, asc, avg, count, desc, eq, ilike, inArray, isNotNull, max, ne, or, sum, sql as drizzleSql } from 'drizzle-orm';

function maskKey(value?: string | null) {
    if (!value) return value;
    return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : '***';
}

function normalizeIdList(value: unknown): number[] {
    return Array.isArray(value) ? value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
}

function parseJsonObject(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function parseModels(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
        } catch {
            return [];
        }
    }
    return [];
}

function pickBodyString(body: Record<string, any>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = body[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function maskTokenRow(row: Record<string, any>) {
    return { ...row, key: maskKey(row.key) };
}

async function refreshRuntimeCaches() {
    await Promise.allSettled([memoryCache.refresh(), optionCache.refresh()]);
}

const IO_DEFAULT_PUBLIC_BASE_URL = 'https://api.io.solutions/v1/io-cloud/caas';
const IO_DEFAULT_ENTERPRISE_BASE_URL = 'https://api.io.solutions/enterprise/v1/io-cloud/caas';

type IoDeploymentSettings = {
    enabled: boolean;
    apiKey: string;
    publicBaseUrl: string;
    enterpriseBaseUrl: string;
};

function parseBooleanOption(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    return false;
}

function sanitizeBaseUrl(value: unknown, fallback: string): string {
    const raw = String(value || '').trim();
    const target = raw || fallback;
    try {
        const parsed = new URL(target);
        return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    } catch {
        return fallback;
    }
}

function getIoDeploymentSettings(): IoDeploymentSettings {
    return {
        enabled: parseBooleanOption(optionCache.get('model_deployment.ionet.enabled', false)),
        apiKey: String(optionCache.get('model_deployment.ionet.api_key', '') || '').trim(),
        publicBaseUrl: sanitizeBaseUrl(optionCache.get('model_deployment.ionet.public_base_url', IO_DEFAULT_PUBLIC_BASE_URL), IO_DEFAULT_PUBLIC_BASE_URL),
        enterpriseBaseUrl: sanitizeBaseUrl(optionCache.get('model_deployment.ionet.enterprise_base_url', IO_DEFAULT_ENTERPRISE_BASE_URL), IO_DEFAULT_ENTERPRISE_BASE_URL),
    };
}

function normalizeTimestampSeconds(value: unknown): number {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return Math.floor(value.getTime() / 1000);
    if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    if (typeof value === 'string' && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    }
    return Math.floor(Date.now() / 1000);
}

function parseIoApiError(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== 'object') return fallback;
    const data = payload as Record<string, any>;
    if (typeof data.detail === 'string' && data.detail.trim()) return data.detail.trim();
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
    if (data.error && typeof data.error === 'object') {
        const nestedMessage = data.error.message;
        if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim();
    }
    return fallback;
}

function unwrapIoData(payload: unknown): any {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in (payload as Record<string, any>)) {
        return (payload as Record<string, any>).data;
    }
    return payload;
}

function buildQueryParams(query: Record<string, unknown>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
            if (value.length === 0) continue;
            params.set(key, JSON.stringify(value));
            continue;
        }
        params.set(key, String(value));
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
}

async function upsertOption(key: string, value: unknown) {
    const nextValue = typeof value === 'string' ? value : JSON.stringify(value);
    await db.insert(options).values({ key, value: nextValue }).onConflictDoUpdate({
        target: options.key,
        set: { value: nextValue },
    });
}

async function callIoApi({
    path,
    method = 'GET',
    body,
    query = {},
    enterprise = true,
    apiKeyOverride,
    requireEnabled = true,
}: {
    path: string;
    method?: string;
    body?: unknown;
    query?: Record<string, unknown>;
    enterprise?: boolean;
    apiKeyOverride?: string;
    requireEnabled?: boolean;
}) {
    const settings = getIoDeploymentSettings();
    if (requireEnabled && !settings.enabled) {
        return { ok: false, status: 400, payload: { detail: 'io.net model deployment is not enabled' }, settings };
    }
    const apiKey = String(apiKeyOverride || settings.apiKey || '').trim();
    if (!apiKey) {
        return { ok: false, status: 400, payload: { detail: 'api_key is required' }, settings };
    }
    const baseUrl = enterprise ? settings.enterpriseBaseUrl : settings.publicBaseUrl;
    const url = assertSafeExternalUrl(`${baseUrl}${path}${buildQueryParams(query)}`).toString();
    try {
        const response = await fetch(url, {
            method,
            headers: {
                'x-api-key': apiKey,
                'content-type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const raw = await response.text();
        let payload: unknown = {};
        if (raw.trim()) {
            try {
                payload = JSON.parse(raw);
            } catch {
                payload = { detail: raw };
            }
        }
        return { ok: response.ok, status: response.status, payload, settings };
    } catch (error) {
        return { ok: false, status: 502, payload: { detail: error instanceof Error ? error.message : 'Network error' }, settings };
    }
}

function toDeploymentSummary(row: Record<string, any>) {
    const status = String(row.status || '').toLowerCase();
    const computeRemaining = Number(row.compute_minutes_remaining ?? row.computeMinutesRemaining ?? 0);
    const createdAt = normalizeTimestampSeconds(row.created_at ?? row.createdAt);
    const updatedAt = normalizeTimestampSeconds(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt);
    const hours = Math.floor(computeRemaining / 60);
    const minutes = computeRemaining % 60;
    const timeRemaining = computeRemaining <= 0 ? 'completed' : (hours > 0 ? `${hours} hour ${minutes} minutes` : `${minutes} minutes`);
    return {
        id: row.id,
        deployment_name: row.name || row.deployment_name || row.id,
        container_name: row.name || row.deployment_name || row.id,
        status,
        type: 'Container',
        time_remaining: timeRemaining,
        time_remaining_minutes: computeRemaining,
        hardware_info: `${row.brand_name || row.brandName || ''} ${row.hardware_name || row.hardwareName || ''} x${Number(row.hardware_quantity ?? row.hardwareQuantity ?? 0)}`.trim(),
        hardware_name: row.hardware_name || row.hardwareName || '',
        brand_name: row.brand_name || row.brandName || '',
        hardware_quantity: Number(row.hardware_quantity ?? row.hardwareQuantity ?? 0),
        completed_percent: Number(row.completed_percent ?? row.completedPercent ?? 0),
        compute_minutes_served: Number(row.compute_minutes_served ?? row.computeMinutesServed ?? 0),
        compute_minutes_remaining: computeRemaining,
        created_at: createdAt,
        updated_at: updatedAt,
        model_name: '',
        model_version: '',
        instance_count: Number(row.hardware_quantity ?? row.hardwareQuantity ?? 0),
        resource_config: {
            cpu: '',
            memory: '',
            gpu: String(Number(row.hardware_quantity ?? row.hardwareQuantity ?? 0)),
        },
        description: '',
        provider: 'io.net',
    };
}

function computeDeploymentStatusCounts(items: Record<string, any>[]) {
    const counts: Record<string, number> = { all: items.length };
    for (const status of ['running', 'completed', 'failed', 'deployment requested', 'termination requested', 'destroyed']) {
        counts[status] = 0;
    }
    for (const item of items) {
        const status = String(item.status || '').toLowerCase();
        counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
}

const channelListSelection = {
    id: channels.id,
    name: channels.name,
    type: channels.type,
    baseUrl: channels.baseUrl,
    models: channels.models,
    priority: channels.priority,
    weight: channels.weight,
    groups: channels.groups,
    status: channels.status,
    tag: channels.tag,
    createdAt: channels.createdAt,
    updatedAt: channels.updatedAt,
};

const channelDetailSelection = {
    id: channels.id,
    name: channels.name,
    type: channels.type,
    key: channels.key,
    baseUrl: channels.baseUrl,
    models: channels.models,
    modelMapping: channels.modelMapping,
    priority: channels.priority,
    weight: channels.weight,
    groups: channels.groups,
    status: channels.status,
    tag: channels.tag,
    setting: channels.setting,
    paramOverride: channels.paramOverride,
    headerOverride: channels.headerOverride,
    channelInfo: channels.channelInfo,
    createdAt: channels.createdAt,
    updatedAt: channels.updatedAt,
};

const channelTestSelection = {
    id: channels.id,
    name: channels.name,
    type: channels.type,
    status: channels.status,
    testAt: channels.testAt,
    responseTime: channels.responseTime,
    statusMessage: channels.statusMessage,
};

const tokenSelfSelection = {
    id: tokens.id,
    name: tokens.name,
    key: tokens.key,
    status: tokens.status,
    remainQuota: tokens.remainQuota,
    usedQuota: tokens.usedQuota,
    models: tokens.models,
    subnet: tokens.subnet,
    allowIps: tokens.allowIps,
    rateLimit: tokens.rateLimit,
    unlimitedQuota: tokens.unlimitedQuota,
    modelLimitsEnabled: tokens.modelLimitsEnabled,
    group: tokens.tokenGroup,
    crossGroupRetry: tokens.crossGroupRetry,
    accessedAt: tokens.accessedAt,
    expiredAt: tokens.expiredAt,
    createdAt: tokens.createdAt,
    updatedAt: tokens.updatedAt,
};

const modelSelection = {
    id: modelMetadata.id,
    modelName: modelMetadata.modelName,
    type: modelMetadata.type,
    endpoint: modelMetadata.endpoint,
    displayName: modelMetadata.displayName,
    tags: modelMetadata.tags,
    createdAt: modelMetadata.createdAt,
    updatedAt: modelMetadata.updatedAt,
};

const vendorSelection = {
    id: vendors.id,
    name: vendors.name,
    type: vendors.type,
    baseUrl: vendors.baseUrl,
    logoUrl: vendors.logoUrl,
    description: vendors.description,
    config: vendors.config,
    createdAt: vendors.createdAt,
    updatedAt: vendors.updatedAt,
};

async function updateChannelBalance(channel: Record<string, any>) {
    const keys = getChannelKeys(channel.key);
    if (keys.length === 0) return { id: channel.id, name: channel.name, balance: null, message: 'No keys configured' };

    const handler = getProviderHandler(Number(channel.type), channel.base_url);
    const baseUrl = String(channel.base_url || '').replace(/\/+$/, '');
    const balanceUrl = Number(channel.type) === ChannelType.AZURE ? `${baseUrl}/status` : `${baseUrl}/dashboard/billing/credit_grants`;
    const res = await fetch(balanceUrl, { headers: handler.buildHeaders(keys[0]) });
    if (!res.ok) return { id: channel.id, name: channel.name, balance: null, message: `Balance endpoint returned ${res.status}` };

    const data = await res.json().catch(() => ({}));
    const balance = Number(data.total_available ?? data.total_granted ?? data.balance ?? 0);
    await db.update(channels).set({ balance: String(balance), balanceUpdatedAt: new Date() }).where(eq(channels.id, Number(channel.id)));
    return { id: channel.id, name: channel.name, balance };
}

async function fetchUpstreamModelsForChannel(channel: Record<string, any>): Promise<string[]> {
    const keys = getChannelKeys(channel.key);
    if (keys.length === 0) throw new Error('No keys configured');
    const handler = getProviderHandler(Number(channel.type), channel.base_url);
    const baseUrl = String(channel.base_url || '').replace(/\/+$/, '');
    const res = await fetch(buildModelsUrl(baseUrl, Number(channel.type)), { headers: handler.buildHeaders(keys[0]) });
    if (!res.ok) throw new Error(`Upstream returned HTTP ${res.status}`);
    const data = await res.json();
    if (Number(channel.type) === ChannelType.GEMINI) {
        return (data.models || []).map((model: Record<string, any>) => model.name?.replace('models/', '') || model.displayName).filter(Boolean);
    }
    if (Array.isArray(data.data)) return data.data.map((model: Record<string, any>) => model.id || model.name).filter(Boolean);
    if (Array.isArray(data)) return data.map((model: Record<string, any>) => model.id || model.name).filter(Boolean);
    return [];
}

function buildModelDiff(current: string[], upstream: string[]) {
    return {
        currentCount: current.length,
        upstreamCount: upstream.length,
        added: upstream.filter((model) => !current.includes(model)),
        removed: current.filter((model) => !upstream.includes(model)),
    };
}

function normalizeMultiKeyInfo(value: unknown) {
    const info = parseJsonObject(value);
    info.multiKeyStatusList = parseJsonObject(info.multiKeyStatusList);
    info.multiKeyDisabledReason = parseJsonObject(info.multiKeyDisabledReason);
    info.multiKeyDisabledTime = parseJsonObject(info.multiKeyDisabledTime);
    return info;
}

function getKeyStatus(info: Record<string, any>, index: number): number {
    const value = info.multiKeyStatusList?.[index];
    if (value === undefined || value === null) return 1;
    const numeric = Number(value);
    return numeric === 0 ? 2 : numeric;
}

function setKeyStatus(info: Record<string, any>, index: number, status: number, reason?: string) {
    if (status === 1) {
        delete info.multiKeyStatusList[index];
        delete info.multiKeyDisabledReason[index];
        delete info.multiKeyDisabledTime[index];
        return;
    }
    info.multiKeyStatusList[index] = status;
    info.multiKeyDisabledReason[index] = reason || (status === 2 ? 'manual disabled' : 'auto disabled');
    info.multiKeyDisabledTime[index] = Date.now();
}

function buildMultiKeyStatus(keys: string[], info: Record<string, any>, page = 1, pageSize = 50, statusFilter?: number) {
    const all = keys.map((key, index) => {
        const status = getKeyStatus(info, index);
        return {
            index,
            status,
            disabled_time: Number(info.multiKeyDisabledTime?.[index] || 0),
            reason: info.multiKeyDisabledReason?.[index] || '',
            key_preview: maskKey(key),
        };
    });
    const enabledCount = all.filter((item) => item.status === 1).length;
    const manualDisabledCount = all.filter((item) => item.status === 2).length;
    const autoDisabledCount = all.filter((item) => item.status === 3).length;
    const filtered = statusFilter ? all.filter((item) => item.status === statusFilter) : all;
    const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const start = (safePage - 1) * safePageSize;
    return {
        keys: filtered.slice(start, start + safePageSize),
        total: filtered.length,
        page: safePage,
        page_size: safePageSize,
        total_pages: Math.max(Math.ceil(filtered.length / safePageSize), 1),
        enabled_count: enabledCount,
        manual_disabled_count: manualDisabledCount,
        auto_disabled_count: autoDisabledCount,
    };
}

async function updateMultiKeyChannel(channelId: number, keys: string[], info: Record<string, any>) {
    info.isMultiKey = keys.length > 1;
    info.multiKeySize = keys.length;
    const enabledCount = keys.filter((_, index) => getKeyStatus(info, index) === 1).length;
    const channelStatus = enabledCount > 0 ? 1 : 3;
    await db.update(channels).set({
        key: encryptChannelKeys(keys.join('\n')),
        channelInfo: info,
        status: channelStatus,
        updatedAt: new Date(),
    }).where(eq(channels.id, channelId));
    await refreshRuntimeCaches();
    return channelStatus;
}

export const newApiCompatAdminRouter = new Elysia()
    .use(adminGuard)

    // New API: /api/channel/*
    .get('/channel', async () => {
        return await db.select(channelListSelection).from(channels).orderBy(desc(channels.id));
    })
    .get('/channel/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const tag = query?.tag;
        const type = query?.type;
        const status = query?.status;
        const conditions = [];
        if (keyword) {
            conditions.push(or(
                ilike(channels.name, `%${keyword}%`),
                drizzleSql`${channels.id}::text ILIKE ${`%${keyword}%`}`,
            ));
        }
        if (tag) conditions.push(eq(channels.tag, String(tag)));
        if (type !== undefined) conditions.push(eq(channels.type, Number(type)));
        if (status !== undefined) conditions.push(eq(channels.status, Number(status)));

        return await db.select(channelListSelection).from(channels)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(channels.id))
            .limit(200);
    })
    .get('/channel/models', async () => {
        const rows = await db.select({ models: channels.models }).from(channels).orderBy(desc(channels.id));
        const modelSet = new Set<string>();
        for (const row of rows) for (const model of parseModels(row.models)) modelSet.add(model);
        return { success: true, data: [...modelSet].sort(), models: [...modelSet].sort() };
    })
    .get('/channel/models_enabled', async () => {
        const rows = await db.select({ models: channels.models }).from(channels).where(eq(channels.status, 1)).orderBy(desc(channels.id));
        const modelSet = new Set<string>();
        for (const row of rows) for (const model of parseModels(row.models)) modelSet.add(model);
        return { success: true, data: [...modelSet].sort(), models: [...modelSet].sort() };
    })
    .get('/channel/test', async () => {
        const rows = await db.select(channelTestSelection).from(channels).orderBy(desc(channels.id));
        return { success: true, tested: rows.length, results: rows };
    })
    .get('/channel/test/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.select(channelTestSelection).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        return { success: true, ...row };
    })
    .get('/channel/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.select(channelDetailSelection).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        return { success: true, data: { ...row, key: maskKey(row.key) } };
    })
    .post('/channel', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        if (!b.name || !b.key) {
            set.status = 400;
            return { success: false, message: 'name and key are required' };
        }
        const [row] = await db.insert(channels).values({
            name: b.name,
            type: Number(b.type || ChannelType.OPENAI),
            key: encryptChannelKeys(String(b.key)),
            baseUrl: b.baseUrl || b.base_url || 'https://api.openai.com',
            models: b.models || [],
            modelMapping: b.modelMapping || b.model_mapping || {},
            priority: Number(b.priority || 0),
            weight: Number(b.weight || 1),
            groups: b.groups || null,
            status: Number(b.status || 1),
            keyStrategy: Number(b.keyStrategy || b.key_strategy || 0),
            keyStatus: {},
            priceRatio: String(Number(b.priceRatio || b.price_ratio || 1)),
            endpointType: b.endpointType || b.endpoint_type || 'auto',
            setting: b.setting || {},
            paramOverride: b.paramOverride || b.param_override || {},
            headerOverride: b.headerOverride || b.header_override || {},
            tag: b.tag || null,
            channelInfo: b.channelInfo || b.channel_info || {},
        }).returning({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            baseUrl: channels.baseUrl,
            models: channels.models,
            status: channels.status,
        });
        await refreshRuntimeCaches();
        return { success: true, data: row };
    })
    .put('/channel', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) {
            set.status = 400;
            return { success: false, message: 'id is required' };
        }
        const [old] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
        if (!old) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        const nextKey = b.key ? encryptChannelKeys(String(b.key)) : old.key;
        const [row] = await db.update(channels).set({
            name: b.name ?? old.name,
            type: Number(b.type ?? old.type),
            key: nextKey,
            baseUrl: b.baseUrl ?? b.base_url ?? old.baseUrl,
            models: b.models ?? old.models,
            modelMapping: b.modelMapping ?? b.model_mapping ?? old.modelMapping,
            priority: Number(b.priority ?? old.priority),
            weight: Number(b.weight ?? old.weight),
            groups: b.groups ?? old.groups,
            status: Number(b.status ?? old.status),
            setting: b.setting ?? old.setting,
            paramOverride: b.paramOverride ?? b.param_override ?? old.paramOverride,
            headerOverride: b.headerOverride ?? b.header_override ?? old.headerOverride,
            tag: b.tag ?? old.tag,
            channelInfo: b.channelInfo ?? b.channel_info ?? old.channelInfo,
            updatedAt: new Date(),
        }).where(eq(channels.id, id)).returning({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            baseUrl: channels.baseUrl,
            models: channels.models,
            status: channels.status,
        });
        await refreshRuntimeCaches();
        return { success: true, data: row };
    })
    .delete('/channel/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.delete(channels).where(eq(channels.id, Number(id))).returning({ id: channels.id });
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        await refreshRuntimeCaches();
        return { success: true, deleted: row.id };
    })
    .post('/channel/batch', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const ids = normalizeIdList(b.ids || b.channelIds);
        if (ids.length === 0) {
            set.status = 400;
            return { success: false, message: 'No channel IDs provided' };
        }

        if (b.action === 'delete') {
            const result = await db.delete(channels).where(inArray(channels.id, ids)).returning({ id: channels.id });
            await refreshRuntimeCaches();
            return { success: true, deleted: result.length };
        }

        if (b.action === 'enable' || b.action === 'disable') {
            const status = b.action === 'enable' ? 1 : 3;
            await db.update(channels).set({ status, updatedAt: new Date() }).where(inArray(channels.id, ids));
            await refreshRuntimeCaches();
            return { success: true, updated: ids.length, status };
        }

        if (b.action === 'tag') {
            await db.update(channels).set({ tag: b.tag || null, updatedAt: new Date() }).where(inArray(channels.id, ids));
            await refreshRuntimeCaches();
            return { success: true, updated: ids.length, tag: b.tag || null };
        }

        set.status = 400;
        return { success: false, message: 'Unsupported batch action' };
    })
    .post('/channel/batch/delete', async ({ body, set }: ElysiaCtx) => {
        const ids = normalizeIdList((body as Record<string, any>)?.ids || (body as Record<string, any>)?.channelIds);
        if (ids.length === 0) {
            set.status = 400;
            return { success: false, message: 'No channel IDs provided' };
        }
        const result = await db.delete(channels).where(inArray(channels.id, ids)).returning({ id: channels.id });
        await refreshRuntimeCaches();
        return { success: true, deleted: result.length };
    })
    .delete('/channel/disabled', async () => {
        const result = await db.delete(channels).where(inArray(channels.status, [2, 3])).returning({ id: channels.id });
        await refreshRuntimeCaches();
        return { success: true, deleted: result.length };
    })
    .get('/channel/tags', async () => {
        return await db.select({
            tag: channels.tag,
            count: drizzleSql<number>`count(*)::int`,
        }).from(channels)
            .where(and(isNotNull(channels.tag), ne(channels.tag, '')))
            .groupBy(channels.tag)
            .orderBy(desc(drizzleSql`count(*)`));
    })
    .post('/channel/tag/:tag/enable', async ({ params: { tag } }: ElysiaCtx) => {
        await db.update(channels).set({ status: 1, updatedAt: new Date() }).where(eq(channels.tag, tag));
        await refreshRuntimeCaches();
        return { success: true, updated: true };
    })
    .post('/channel/tag/:tag/disable', async ({ params: { tag } }: ElysiaCtx) => {
        await db.update(channels).set({ status: 3, updatedAt: new Date() }).where(eq(channels.tag, tag));
        await refreshRuntimeCaches();
        return { success: true, updated: true };
    })
    .post('/channel/tag/:tag/rename', async ({ params: { tag }, body }: ElysiaCtx) => {
        const newTag = (body as Record<string, any>)?.newTag || (body as Record<string, any>)?.tag || null;
        await db.update(channels).set({ tag: newTag, updatedAt: new Date() }).where(eq(channels.tag, tag));
        await refreshRuntimeCaches();
        return { success: true, updated: true, tag: newTag };
    })
    .post('/channel/tag/disabled', async ({ body, set }: ElysiaCtx) => {
        const tag = pickBodyString(body as Record<string, any>, 'tag');
        if (!tag) {
            set.status = 400;
            return { success: false, message: 'tag is required' };
        }
        await db.update(channels).set({ status: 3, updatedAt: new Date() }).where(eq(channels.tag, tag));
        await refreshRuntimeCaches();
        return { success: true, updated: true };
    })
    .post('/channel/tag/enabled', async ({ body, set }: ElysiaCtx) => {
        const tag = pickBodyString(body as Record<string, any>, 'tag');
        if (!tag) {
            set.status = 400;
            return { success: false, message: 'tag is required' };
        }
        await db.update(channels).set({ status: 1, updatedAt: new Date() }).where(eq(channels.tag, tag));
        await refreshRuntimeCaches();
        return { success: true, updated: true };
    })
    .put('/channel/tag', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const tag = pickBodyString(b, 'tag');
        if (!tag) {
            set.status = 400;
            return { success: false, message: 'tag is required' };
        }
        const updates: Record<string, any> = {};
        if (b.new_tag !== undefined || b.newTag !== undefined) updates.tag = b.new_tag ?? b.newTag;
        if (b.models !== undefined) updates.models = typeof b.models === 'string' ? parseModels(b.models) : b.models;
        if (b.model_mapping !== undefined || b.modelMapping !== undefined) updates.modelMapping = b.model_mapping ?? b.modelMapping;
        if (b.groups !== undefined) updates.groups = b.groups;
        if (b.priority !== undefined) updates.priority = Number(b.priority);
        if (b.weight !== undefined) updates.weight = Number(b.weight);
        if (b.param_override !== undefined || b.paramOverride !== undefined) updates.paramOverride = b.param_override ?? b.paramOverride;
        if (b.header_override !== undefined || b.headerOverride !== undefined) updates.headerOverride = b.header_override ?? b.headerOverride;
        updates.updatedAt = new Date();

        const matchingChannels = await db.select({ id: channels.id }).from(channels).where(eq(channels.tag, tag));
        await db.update(channels).set(updates).where(eq(channels.tag, tag));
        await refreshRuntimeCaches();
        return { success: true, updated: matchingChannels.length };
    })
    .get('/channel/tag/:tag/models', async ({ params: { tag } }: ElysiaCtx) => {
        const rows = await db.select({ models: channels.models }).from(channels).where(and(eq(channels.tag, tag), eq(channels.status, 1)));
        const modelSet = new Set<string>();
        for (const row of rows) for (const model of parseModels(row.models)) modelSet.add(model);
        return { success: true, tag, models: [...modelSet].sort(), count: modelSet.size };
    })
    .get('/channel/tag/models', async ({ query, set }: ElysiaCtx) => {
        const tag = query?.tag;
        if (!tag) {
            set.status = 400;
            return { success: false, message: 'tag query is required' };
        }
        const rows = await db.select({ models: channels.models }).from(channels).where(and(eq(channels.tag, String(tag)), eq(channels.status, 1)));
        const modelSet = new Set<string>();
        for (const row of rows) for (const model of parseModels(row.models)) modelSet.add(model);
        return { success: true, tag, models: [...modelSet].sort(), count: modelSet.size };
    })
    .get('/channel/enabled_models', async () => {
        const rows = await db.select({ models: channels.models }).from(channels).where(eq(channels.status, 1));
        const modelSet = new Set<string>();
        for (const row of rows) for (const model of parseModels(row.models)) modelSet.add(model);
        return { success: true, models: [...modelSet].sort(), count: modelSet.size };
    })
    .get('/channel/update_balance', async () => {
        const activeChannels = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            base_url: channels.baseUrl,
            key: channels.key,
        }).from(channels).where(eq(channels.status, 1)).orderBy(desc(channels.id));
        const results = [];
        for (const channel of activeChannels) {
            try {
                results.push(await updateChannelBalance(channel));
            } catch (error: unknown) {
                results.push({ id: channel.id, name: channel.name, balance: null, message: error instanceof Error ? error.message : String(error) });
            }
        }
        return { success: true, checked: results.length, results };
    })
    .get('/channel/update_balance/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            base_url: channels.baseUrl,
            key: channels.key,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        try {
            return { success: true, ...(await updateChannelBalance(channel)) };
        } catch (error: unknown) {
            set.status = 500;
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    })
    .get('/channel/:id/keys/status', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await db.select({
            key: channels.key,
            key_status: channels.keyStatus,
            channel_info: channels.channelInfo,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }

        const keys = getChannelKeys(channel.key);
        const keyStatus = parseJsonObject(channel.key_status);
        const info = parseJsonObject(channel.channel_info);
        const disabledList = parseJsonObject(info.multiKeyStatusList);
        const disabledReasons = parseJsonObject(info.multiKeyDisabledReason);
        const disabledTimes = parseJsonObject(info.multiKeyDisabledTime);

        return {
            success: true,
            totalKeys: keys.length,
            keys: keys.map((key, index) => ({
                index,
                masked: maskKey(key),
                status: keyStatus[key]?.status || keyStatus[key] || (disabledList[index] === 0 ? 'disabled' : 'active'),
                reason: disabledReasons[index] || keyStatus[key]?.reason || null,
                disabledAt: disabledTimes[index] ? new Date(Number(disabledTimes[index])).toISOString() : null,
            })),
        };
    })
    .post('/channel/:id/keys/status', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const index = Number(b.keyIndex ?? b.index);
        const enabled = b.enabled !== undefined ? Boolean(b.enabled) : b.status === 'enabled';
        const [channel] = await db.select({
            key: channels.key,
            status: channels.status,
            channel_info: channels.channelInfo,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        const keys = getChannelKeys(channel.key);
        if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
            set.status = 400;
            return { success: false, message: 'Invalid key index' };
        }
        const info = parseJsonObject(channel.channel_info);
        info.multiKeyStatusList = parseJsonObject(info.multiKeyStatusList);
        info.multiKeyDisabledReason = parseJsonObject(info.multiKeyDisabledReason);
        info.multiKeyDisabledTime = parseJsonObject(info.multiKeyDisabledTime);
        if (enabled) {
            delete info.multiKeyStatusList[index];
            delete info.multiKeyDisabledReason[index];
            delete info.multiKeyDisabledTime[index];
        } else {
            info.multiKeyStatusList[index] = 0;
            info.multiKeyDisabledReason[index] = b.reason || 'manual disabled';
            info.multiKeyDisabledTime[index] = Date.now();
        }
        const enabledCount = keys.filter((_, i) => info.multiKeyStatusList[i] !== 0).length;
        const status = enabledCount > 0 ? 1 : 3;
        await db.update(channels).set({ channelInfo: info, status, updatedAt: new Date() }).where(eq(channels.id, Number(id)));
        await refreshRuntimeCaches();
        return { success: true, channelInfo: info, channelStatus: status };
    })
    .post('/channel/multi_key/manage', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const channelId = Number(b.channel_id ?? b.channelId);
        const action = String(b.action || '');
        if (!channelId || !action) {
            set.status = 400;
            return { success: false, message: 'channel_id and action are required' };
        }

        const [channel] = await db.select({
            id: channels.id,
            key: channels.key,
            channel_info: channels.channelInfo,
        }).from(channels).where(eq(channels.id, channelId)).limit(1);
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        let keys = getChannelKeys(channel.key);
        const info = normalizeMultiKeyInfo(channel.channel_info);
        info.isMultiKey = true;
        info.multiKeySize = keys.length;

        if (action === 'get_key_status') {
            return {
                success: true,
                message: '',
                data: buildMultiKeyStatus(keys, info, Number(b.page || 1), Number(b.page_size || b.pageSize || 50), b.status === undefined ? undefined : Number(b.status)),
            };
        }

        const keyIndex = b.key_index === undefined && b.keyIndex === undefined ? undefined : Number(b.key_index ?? b.keyIndex);
        if (['disable_key', 'enable_key', 'delete_key'].includes(action) && (keyIndex === undefined || !Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= keys.length)) {
            set.status = 400;
            return { success: false, message: 'valid key_index is required' };
        }

        if (action === 'disable_key') {
            setKeyStatus(info, keyIndex!, 2, b.reason || 'manual disabled');
            const channelStatus = await updateMultiKeyChannel(channelId, keys, info);
            return { success: true, message: 'key disabled', channelStatus };
        }

        if (action === 'enable_key') {
            setKeyStatus(info, keyIndex!, 1);
            const channelStatus = await updateMultiKeyChannel(channelId, keys, info);
            return { success: true, message: 'key enabled', channelStatus };
        }

        if (action === 'enable_all_keys') {
            info.multiKeyStatusList = {};
            info.multiKeyDisabledTime = {};
            info.multiKeyDisabledReason = {};
            const channelStatus = await updateMultiKeyChannel(channelId, keys, info);
            return { success: true, message: 'all keys enabled', channelStatus };
        }

        if (action === 'disable_all_keys') {
            for (let index = 0; index < keys.length; index++) setKeyStatus(info, index, 2, b.reason || 'manual disabled');
            const channelStatus = await updateMultiKeyChannel(channelId, keys, info);
            return { success: true, message: 'all keys disabled', channelStatus };
        }

        if (action === 'delete_key') {
            keys = keys.filter((_, index) => index !== keyIndex);
            const nextInfo = normalizeMultiKeyInfo(info);
            nextInfo.multiKeyStatusList = {};
            nextInfo.multiKeyDisabledTime = {};
            nextInfo.multiKeyDisabledReason = {};
            for (let oldIndex = 0, newIndex = 0; oldIndex < info.multiKeySize; oldIndex++) {
                if (oldIndex === keyIndex) continue;
                const status = getKeyStatus(info, oldIndex);
                if (status !== 1) setKeyStatus(nextInfo, newIndex, status, info.multiKeyDisabledReason?.[oldIndex]);
                if (info.multiKeyDisabledTime?.[oldIndex]) nextInfo.multiKeyDisabledTime[newIndex] = info.multiKeyDisabledTime[oldIndex];
                newIndex++;
            }
            const channelStatus = await updateMultiKeyChannel(channelId, keys, nextInfo);
            return { success: true, message: 'key deleted', channelStatus, data: keys.length };
        }

        if (action === 'delete_disabled_keys') {
            const remaining: string[] = [];
            const nextInfo = normalizeMultiKeyInfo({});
            let deleted = 0;
            for (let oldIndex = 0; oldIndex < keys.length; oldIndex++) {
                const status = getKeyStatus(info, oldIndex);
                if (status === 3) {
                    deleted++;
                    continue;
                }
                const newIndex = remaining.length;
                remaining.push(keys[oldIndex]);
                if (status !== 1) setKeyStatus(nextInfo, newIndex, status, info.multiKeyDisabledReason?.[oldIndex]);
                if (info.multiKeyDisabledTime?.[oldIndex]) nextInfo.multiKeyDisabledTime[newIndex] = info.multiKeyDisabledTime[oldIndex];
            }
            const channelStatus = await updateMultiKeyChannel(channelId, remaining, nextInfo);
            return { success: true, message: `deleted ${deleted} disabled keys`, channelStatus, data: deleted };
        }

        set.status = 400;
        return { success: false, message: 'Unsupported action' };
    })
    .post('/channel/:id/keys/manage', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const [channel] = await db.select({
            key: channels.key,
            key_status: channels.keyStatus,
            channel_info: channels.channelInfo,
        }).from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }

        let keys = getChannelKeys(channel.key);
        if (b.action === 'add' && Array.isArray(b.keys)) {
            keys = [...keys, ...b.keys.map((key: string) => key.trim()).filter(Boolean)];
        } else if (b.action === 'remove' && Array.isArray(b.keyIndices)) {
            const removeSet = new Set(b.keyIndices.map((value: number) => Number(value)));
            keys = keys.filter((_, index) => !removeSet.has(index));
        } else if (b.action === 'replace') {
            keys = Array.isArray(b.keys)
                ? b.keys.map((key: string) => key.trim()).filter(Boolean)
                : String(b.keys || '').split('\n').map((key) => key.trim()).filter(Boolean);
        } else {
            set.status = 400;
            return { success: false, message: 'Invalid action. Use add, remove, or replace.' };
        }

        const info = parseJsonObject(channel.channel_info);
        info.isMultiKey = keys.length > 1;
        info.multiKeySize = keys.length;
        await db.update(channels).set({
            key: encryptChannelKeys(keys.join('\n')),
            keyStatus: parseJsonObject(channel.key_status),
            channelInfo: info,
            updatedAt: new Date(),
        }).where(eq(channels.id, Number(id)));
        await refreshRuntimeCaches();
        return { success: true, keyCount: keys.length };
    })
    .post('/channel/upstream_updates/detect', async ({ body, set }: ElysiaCtx) => {
        const channelId = Number((body as Record<string, any>)?.channel_id ?? (body as Record<string, any>)?.channelId ?? (body as Record<string, any>)?.id);
        if (!channelId) {
            set.status = 400;
            return { success: false, message: 'channel_id is required' };
        }
        const [channel] = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            base_url: channels.baseUrl,
            key: channels.key,
            models: channels.models,
        }).from(channels).where(eq(channels.id, channelId)).limit(1);
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        try {
            const upstream = await fetchUpstreamModelsForChannel(channel);
            return { success: true, id: channel.id, name: channel.name, ...buildModelDiff(parseModels(channel.models), upstream) };
        } catch (error: unknown) {
            return { success: false, id: channel.id, name: channel.name, message: error instanceof Error ? error.message : String(error) };
        }
    })
    .post('/channel/upstream_updates/apply', async ({ body, set }: ElysiaCtx) => {
        const channelId = Number((body as Record<string, any>)?.channel_id ?? (body as Record<string, any>)?.channelId ?? (body as Record<string, any>)?.id);
        if (!channelId) {
            set.status = 400;
            return { success: false, message: 'channel_id is required' };
        }
        const [channel] = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            base_url: channels.baseUrl,
            key: channels.key,
            models: channels.models,
        }).from(channels).where(eq(channels.id, channelId)).limit(1);
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        try {
            const upstream = await fetchUpstreamModelsForChannel(channel);
            await db.update(channels).set({ models: upstream, updatedAt: new Date() }).where(eq(channels.id, channelId));
            await refreshRuntimeCaches();
            return { success: true, id: channel.id, name: channel.name, modelsCount: upstream.length, ...buildModelDiff(parseModels(channel.models), upstream) };
        } catch (error: unknown) {
            return { success: false, id: channel.id, name: channel.name, message: error instanceof Error ? error.message : String(error) };
        }
    })
    .post('/channel/upstream_updates/detect_all', async () => {
        const activeChannels = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            base_url: channels.baseUrl,
            key: channels.key,
            models: channels.models,
        }).from(channels).where(eq(channels.status, 1)).orderBy(desc(channels.id));
        const results = [];
        for (const channel of activeChannels) {
            try {
                const upstream = await fetchUpstreamModelsForChannel(channel);
                results.push({ success: true, id: channel.id, name: channel.name, ...buildModelDiff(parseModels(channel.models), upstream) });
            } catch (error: unknown) {
                results.push({ success: false, id: channel.id, name: channel.name, message: error instanceof Error ? error.message : String(error) });
            }
        }
        return { success: true, checked: results.length, results };
    })
    .post('/channel/upstream_updates/apply_all', async () => {
        const activeChannels = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            base_url: channels.baseUrl,
            key: channels.key,
            models: channels.models,
        }).from(channels).where(eq(channels.status, 1)).orderBy(desc(channels.id));
        const results = [];
        for (const channel of activeChannels) {
            try {
                const upstream = await fetchUpstreamModelsForChannel(channel);
                await db.update(channels).set({ models: upstream, updatedAt: new Date() }).where(eq(channels.id, channel.id));
                results.push({ success: true, id: channel.id, name: channel.name, modelsCount: upstream.length, ...buildModelDiff(parseModels(channel.models), upstream) });
            } catch (error: unknown) {
                results.push({ success: false, id: channel.id, name: channel.name, message: error instanceof Error ? error.message : String(error) });
            }
        }
        await refreshRuntimeCaches();
        return { success: true, applied: results.filter((result) => result.success).length, total: results.length, results };
    })
    .post('/channel/codex/oauth/start', ({ set }: ElysiaCtx) => {
        if (!isCodexOAuthConfigured()) { set.status = 503; return { success: false, message: 'Codex OAuth is not configured (set CODEX_OAUTH_CLIENT_ID and CODEX_OAUTH_CLIENT_SECRET)' }; }
        const state = Bun.randomUUIDv7('hex');
        const result = createCodexOAuthStartUrl(state);
        if (!result) { set.status = 500; return { success: false, message: 'Failed to generate OAuth URL' }; }
        return { success: true, data: { url: result.url, state } };
    })
    .post('/channel/codex/oauth/complete', async ({ body, set }: ElysiaCtx) => {
        const payload = (body || {}) as Record<string, any>;
        const code = String(payload.code || '');
        if (!code) { set.status = 400; return { success: false, message: 'Authorization code is required' }; }
        const tokens = await exchangeCodexOAuthCode(code);
        if (!tokens) { set.status = 400; return { success: false, message: 'Failed to exchange authorization code for tokens' }; }
        return { success: true, data: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken, expires_in: tokens.expiresIn, scope: tokens.scope } };
    })
    .post('/channel/:id/codex/oauth/start', ({ params: { id }, set }: ElysiaCtx) => {
        if (!isCodexOAuthConfigured()) { set.status = 503; return { success: false, message: 'Codex OAuth is not configured' }; }
        const state = `${id}:${Bun.randomUUIDv7('hex')}`;
        const result = createCodexOAuthStartUrl(state);
        if (!result) { set.status = 500; return { success: false, message: 'Failed to generate OAuth URL' }; }
        return { success: true, data: { url: result.url, state, channelId: Number(id) } };
    })
    .post('/channel/:id/codex/oauth/complete', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const payload = (body || {}) as Record<string, any>;
        const code = String(payload.code || '');
        if (!code) { set.status = 400; return { success: false, message: 'Authorization code is required' }; }

        const tokens = await exchangeCodexOAuthCode(code);
        if (!tokens) { set.status = 400; return { success: false, message: 'Failed to exchange authorization code' }; }

        // 将 OAuth token 存入 channel 的 key 中
        const [ch] = await db.select().from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!ch) { set.status = 404; return { success: false, message: 'Channel not found' }; }

        const existingKeys = decryptChannelKeys(ch.key).split('\n').filter(Boolean);
        const newKey = tokens.accessToken;
        const allKeys = existingKeys.length > 0 ? [...existingKeys, newKey] : [newKey];
        await db.update(channels).set({ key: encryptChannelKeys(allKeys.join('\n')) }).where(eq(channels.id, Number(id)));

        // 存储 refresh_token 到 channelInfo
        const info = { ...(ch.channelInfo as Record<string, any> || {}) };
        info.codexRefreshToken = tokens.refreshToken;
        info.codexTokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
        info.lastCodexToken = newKey;
        await db.update(channels).set({ channelInfo: info }).where(eq(channels.id, Number(id)));

        return { success: true, data: { access_token: tokens.accessToken, expires_in: tokens.expiresIn } };
    })
    .post('/channel/:id/codex/refresh', async ({ params: { id }, set }: ElysiaCtx) => {
        const [ch] = await db.select().from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!ch) { set.status = 404; return { success: false, message: 'Channel not found' }; }

        const info = { ...(ch.channelInfo as Record<string, any> || {}) };
        const refreshToken = String(info.codexRefreshToken || '');
        if (!refreshToken) { set.status = 400; return { success: false, message: 'No refresh token stored for this channel' }; }

        const tokens = await refreshCodexToken(refreshToken);
        if (!tokens) { set.status = 400; return { success: false, message: 'Failed to refresh token' }; }

        // 更新 channel key：替换旧 token 为新 token
        const existingKeys = decryptChannelKeys(ch.key).split('\n').filter(Boolean);
        const oldToken = String(info.lastCodexToken || '');
        const updatedKeys = existingKeys.map(k => k === oldToken ? tokens.accessToken : k);
        await db.update(channels).set({ key: encryptChannelKeys(updatedKeys.join('\n')) }).where(eq(channels.id, Number(id)));

        // 更新 channelInfo
        info.codexRefreshToken = tokens.refreshToken;
        info.codexTokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
        info.lastCodexToken = tokens.accessToken;
        await db.update(channels).set({ channelInfo: info }).where(eq(channels.id, Number(id)));

        return { success: true, data: { access_token: tokens.accessToken, expires_in: tokens.expiresIn } };
    })
    .get('/channel/:id/codex/usage', async ({ params: { id }, set }: ElysiaCtx) => {
        const [ch] = await db.select().from(channels).where(eq(channels.id, Number(id))).limit(1);
        if (!ch) { set.status = 404; return { success: false, message: 'Channel not found' }; }

        const keys = getChannelKeys(ch.key);
        if (!keys || keys.length === 0) { set.status = 400; return { success: false, message: 'No API key for this channel' }; }

        const usage = await getCodexUsage(keys[0]);
        if (!usage) { set.status = 502; return { success: false, message: 'Failed to fetch usage from io.net' }; }
        return { success: true, data: usage };
    })

    // New API: /api/token/*
    .get('/token/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const userId = query?.user_id;
        const status = query?.status;
        const conditions = [];
        if (keyword) conditions.push(ilike(tokens.name, `%${keyword}%`));
        if (userId) conditions.push(eq(tokens.userId, Number(userId)));
        if (status !== undefined) conditions.push(eq(tokens.status, Number(status)));
        const rows = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            models: tokens.models,
            rateLimit: tokens.rateLimit,
            expiredAt: tokens.expiredAt,
            userId: tokens.userId,
            tokenGroup: tokens.tokenGroup,
            crossGroupRetry: tokens.crossGroupRetry,
        }).from(tokens)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(tokens.id))
            .limit(100);
        return rows.map((row: Record<string, any>) => ({ ...row, key: maskKey(row.key) }));
    })
    .post('/token/batch/delete', async ({ body, set }: ElysiaCtx) => {
        const ids = normalizeIdList((body as Record<string, any>)?.ids);
        if (ids.length === 0) {
            set.status = 400;
            return { success: false, message: 'No token IDs provided' };
        }
        const rows = await db.delete(tokens).where(inArray(tokens.id, ids)).returning({ id: tokens.id });
        return { success: true, deleted: rows.length };
    })
    .post('/token/batch/keys', async ({ body, set }: ElysiaCtx) => {
        const ids = normalizeIdList((body as Record<string, any>)?.ids);
        if (ids.length === 0) {
            set.status = 400;
            return { success: false, message: 'No token IDs provided' };
        }
        const rows = await db.select({ id: tokens.id, key: tokens.key }).from(tokens).where(inArray(tokens.id, ids));
        const keys: Record<number, string> = {};
        for (const row of rows) keys[row.id] = row.key;
        return { success: true, keys };
    })
    .get('/token/:id/usage', async ({ params: { id }, set }: ElysiaCtx) => {
        const tokenId = Number(id);
        const [token] = await db.select({
            id: tokens.id,
            name: tokens.name,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            unlimitedQuota: tokens.unlimitedQuota,
        }).from(tokens).where(eq(tokens.id, tokenId)).limit(1);
        if (!token) {
            set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        const [stats] = await db.select({
            totalRequests: drizzleSql<number>`count(*)`,
            totalCost: drizzleSql<number>`coalesce(sum(${logs.quotaCost}), 0)`,
            promptTokens: drizzleSql<number>`coalesce(sum(${logs.promptTokens}), 0)`,
            completionTokens: drizzleSql<number>`coalesce(sum(${logs.completionTokens}), 0)`,
            lastUsed: drizzleSql`max(${logs.createdAt})`,
        }).from(logs).where(eq(logs.tokenId, tokenId));
        return { success: true, token, stats };
    })

    // New API: /api/log/*
    .get('/log', async ({ query }: ElysiaCtx) => {
        const page = Number(query?.page) || 1;
        const limit = Math.min(Number(query?.limit) || 50, 200);
        const offset = (page - 1) * limit;
        const [countRow] = await db.select({ total: drizzleSql<number>`count(*)` }).from(logs);
        const rows = await db.select({
            id: logs.id,
            userId: logs.userId,
            tokenId: logs.tokenId,
            channelId: logs.channelId,
            modelName: logs.modelName,
            quotaCost: logs.quotaCost,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            statusCode: logs.statusCode,
            errorMessage: logs.errorMessage,
            elapsedMs: logs.elapsedMs,
            createdAt: logs.createdAt,
        }).from(logs).orderBy(desc(logs.createdAt)).limit(limit).offset(offset);
        return { data: rows, total: Number(countRow?.total || 0), page, limit };
    })
    .delete('/log', async ({ query }: ElysiaCtx) => {
        const days = Number(query?.days) || 30;
        const result = await db.delete(logs).where(drizzleSql`created_at < NOW() - ${days}::int * INTERVAL '1 day'`);
        return { success: true, deleted: result.length || 0, olderThanDays: days };
    })
    .get('/log/stat', async ({ query }: ElysiaCtx) => {
        const hours = Number(query?.hours) || 24;
        const [stats] = await db.select({
            totalRequests: count(),
            totalCost: drizzleSql`COALESCE(SUM(${logs.quotaCost}), 0)`,
            promptTokens: drizzleSql`COALESCE(SUM(${logs.promptTokens}), 0)`,
            completionTokens: drizzleSql`COALESCE(SUM(${logs.completionTokens}), 0)`,
            avgLatency: drizzleSql`COALESCE(AVG(${logs.elapsedMs}), 0)`,
        }).from(logs)
            .where(drizzleSql`created_at > NOW() - ${hours}::int * INTERVAL '1 hour'`);
        return stats || {};
    })
    .get('/log/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const model = query?.model;
        const userId = query?.user_id;
        const tokenId = query?.token_id;
        const page = Number(query?.page) || 1;
        const limit = Math.min(Number(query?.limit) || 50, 200);
        const offset = (page - 1) * limit;
        const conditions = [] as any[];
        if (keyword) conditions.push(or(ilike(logs.modelName, `%${keyword}%`), ilike(logs.errorMessage, `%${keyword}%`)));
        if (model) conditions.push(eq(logs.modelName, model));
        if (userId) conditions.push(eq(logs.userId, Number(userId) || 0));
        if (tokenId) conditions.push(eq(logs.tokenId, Number(tokenId) || 0));
        const [countRow] = await db.select({ total: count() }).from(logs)
            .where(conditions.length ? and(...conditions) : undefined);
        const rows = await db.select({
            id: logs.id,
            userId: logs.userId,
            tokenId: logs.tokenId,
            channelId: logs.channelId,
            modelName: logs.modelName,
            quotaCost: logs.quotaCost,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            statusCode: logs.statusCode,
            errorMessage: logs.errorMessage,
            elapsedMs: logs.elapsedMs,
            createdAt: logs.createdAt,
        }).from(logs)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(logs.createdAt))
            .limit(limit)
            .offset(offset);
        return { data: rows, total: Number(countRow?.total || 0), page, limit };
    })
    .get('/log/channel_affinity_usage_cache', async () => {
        const { getAffinityStats } = await import('../../services/channelAffinity');
        return getAffinityStats();
    })

    // New API: /api/option/*
    .get('/option', async () => {
        const rows = await db.select({ key: options.key, value: options.value }).from(options).orderBy(asc(options.key));
        const data: Record<string, any> = {};
        for (const row of rows) {
            try {
                data[row.key] = JSON.parse(row.value);
            } catch {
                data[row.key] = row.value;
            }
        }
        return { success: true, data };
    })
    .put('/option', async ({ body }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const entries = b.options && typeof b.options === 'object' ? b.options : b;
        for (const [key, value] of Object.entries(entries)) {
            const nextValue = typeof value === 'string' ? value : JSON.stringify(value);
            await db.insert(options).values({ key, value: nextValue }).onConflictDoUpdate({
                target: options.key,
                set: { value: nextValue },
            });
        }
        await refreshRuntimeCaches();
        return { success: true, updated: Object.keys(entries).length };
    })
    .get('/option/channel_affinity_cache', async () => {
        const { getAffinityStats } = await import('../../services/channelAffinity');
        return getAffinityStats();
    })
    .delete('/option/channel_affinity_cache', async () => {
        const { clearAffinityCache } = await import('../../services/channelAffinity');
        return { success: true, cleared: clearAffinityCache() };
    })
    .post('/option/rest_model_ratio', async () => {
        await db.insert(options).values({ key: 'ModelRatio', value: '{}' }).onConflictDoUpdate({
            target: options.key,
            set: { value: '{}' },
        });
        await refreshRuntimeCaches();
        return { success: true };
    })

    // New API: /api/models/*
    .get('/models', async () => {
        return await db.select(modelSelection).from(modelMetadata).orderBy(asc(modelMetadata.modelName)).limit(500);
    })
    .get('/models/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        return await db.select(modelSelection).from(modelMetadata)
            .where(keyword ? ilike(modelMetadata.modelName, `%${keyword}%`) : undefined)
            .orderBy(asc(modelMetadata.modelName))
            .limit(100);
    })
    .get('/models/missing', async () => {
        const rows: any[] = await db.execute(drizzleSql`
            SELECT DISTINCT model_name FROM (
                SELECT model_name FROM logs
                WHERE created_at > NOW() - INTERVAL '7 days'
                EXCEPT
                SELECT model_name FROM model_metadata
            ) sub
            ORDER BY model_name
        `);
        return { success: true, missing: rows.map((row: any) => row.model_name), count: rows.length };
    })
    .get('/models/sync_upstream/preview', async () => {
        const rows = await db.select({ id: channels.id, name: channels.name, models: channels.models }).from(channels).where(eq(channels.status, 1)).orderBy(desc(channels.id));
        return {
            success: true,
            channels: rows.map((row: any) => ({
                id: row.id,
                name: row.name,
                modelCount: Array.isArray(row.models) ? row.models.length : 0,
            })),
        };
    })
    .post('/models/sync_upstream', async () => {
        return { success: true, message: 'Use /api/channel/upstream_updates/* for channel-level upstream sync.', applied: false };
    })
    .get('/models/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.select(modelSelection).from(modelMetadata).where(eq(modelMetadata.id, Number(id))).limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Model metadata not found' };
        }
        return row;
    })
    .post('/models', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const modelName = b.modelName || b.model_name;
        if (!modelName) {
            set.status = 400;
            return { success: false, message: 'modelName is required' };
        }
        const [row] = await db.insert(modelMetadata).values({
            modelName,
            type: b.type || 'chat',
            endpoint: b.endpoint || null,
            displayName: b.displayName || b.display_name || null,
            tags: b.tags || [],
        }).onConflictDoUpdate({
            target: modelMetadata.modelName,
            set: {
                type: b.type || 'chat',
                endpoint: b.endpoint || null,
                displayName: b.displayName || b.display_name || null,
                tags: b.tags || [],
                updatedAt: new Date(),
            },
        }).returning({
            id: modelMetadata.id,
            modelName: modelMetadata.modelName,
            type: modelMetadata.type,
            endpoint: modelMetadata.endpoint,
            displayName: modelMetadata.displayName,
            tags: modelMetadata.tags,
        });
        await refreshRuntimeCaches();
        return { success: true, data: row };
    })
    .put('/models', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) {
            set.status = 400;
            return { success: false, message: 'id is required' };
        }
        const [old] = await db.select().from(modelMetadata).where(eq(modelMetadata.id, id)).limit(1);
        if (!old) {
            set.status = 404;
            return { success: false, message: 'Model metadata not found' };
        }
        const [row] = await db.update(modelMetadata).set({
            modelName: b.modelName || b.model_name || old.modelName,
            type: b.type || old.type,
            endpoint: b.endpoint ?? old.endpoint,
            displayName: b.displayName ?? b.display_name ?? old.displayName,
            tags: b.tags ?? old.tags,
            updatedAt: new Date(),
        }).where(eq(modelMetadata.id, id)).returning({
            id: modelMetadata.id,
            modelName: modelMetadata.modelName,
            type: modelMetadata.type,
            endpoint: modelMetadata.endpoint,
            displayName: modelMetadata.displayName,
            tags: modelMetadata.tags,
        });
        await refreshRuntimeCaches();
        return { success: true, data: row };
    })
    .delete('/models/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.delete(modelMetadata).where(eq(modelMetadata.id, Number(id))).returning({ id: modelMetadata.id });
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Model metadata not found' };
        }
        await refreshRuntimeCaches();
        return { success: true, deleted: row.id };
    })

    // New API: /api/ratio_sync/*
    .get('/ratio_sync/channels', async () => {
        return await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            baseUrl: channels.baseUrl,
            status: channels.status,
        }).from(channels).where(eq(channels.status, 1)).orderBy(desc(channels.id));
    })
    .post('/ratio_sync/fetch', async () => {
        return {
            success: true,
            modelRatio: optionCache.get('ModelRatio', {}),
            completionRatio: optionCache.get('CompletionRatio', {}),
            groupRatio: optionCache.get('GroupRatio', {}),
        };
    })

    // New API: /api/vendors/*
    .get('/vendors', async () => {
        return await db.select(vendorSelection).from(vendors).orderBy(asc(vendors.name));
    })
    .get('/vendors/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        return await db.select({
            id: vendors.id,
            name: vendors.name,
            type: vendors.type,
            baseUrl: vendors.baseUrl,
            logoUrl: vendors.logoUrl,
            description: vendors.description,
        }).from(vendors)
            .where(keyword ? or(
                ilike(vendors.name, `%${keyword}%`),
                drizzleSql`${vendors.type}::text ILIKE ${`%${keyword}%`}`,
            ) : undefined)
            .orderBy(asc(vendors.name))
            .limit(50);
    })
    .get('/vendors/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.select(vendorSelection).from(vendors).where(eq(vendors.id, Number(id))).limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Vendor not found' };
        }
        return row;
    })
    .post('/vendors', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        if (!b.name) {
            set.status = 400;
            return { success: false, message: 'name is required' };
        }
        const [row] = await db.insert(vendors).values({
            name: b.name,
            type: Number(b.type || 0),
            baseUrl: b.baseUrl || b.base_url || '',
            logoUrl: b.logoUrl || b.logo_url || null,
            description: b.description || null,
            config: b.config || {},
        }).returning({
            id: vendors.id,
            name: vendors.name,
            type: vendors.type,
            baseUrl: vendors.baseUrl,
            logoUrl: vendors.logoUrl,
            description: vendors.description,
            config: vendors.config,
        });
        return { success: true, data: row };
    })
    .put('/vendors', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) {
            set.status = 400;
            return { success: false, message: 'id is required' };
        }
        const [old] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
        if (!old) {
            set.status = 404;
            return { success: false, message: 'Vendor not found' };
        }
        const [row] = await db.update(vendors).set({
            name: b.name ?? old.name,
            type: Number(b.type ?? old.type),
            baseUrl: b.baseUrl ?? b.base_url ?? old.baseUrl,
            logoUrl: b.logoUrl ?? b.logo_url ?? old.logoUrl,
            description: b.description ?? old.description,
            config: b.config ?? old.config,
            updatedAt: new Date(),
        }).where(eq(vendors.id, id)).returning({
            id: vendors.id,
            name: vendors.name,
            type: vendors.type,
            baseUrl: vendors.baseUrl,
            logoUrl: vendors.logoUrl,
            description: vendors.description,
            config: vendors.config,
        });
        return { success: true, data: row };
    })
    .delete('/vendors/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await db.delete(vendors).where(eq(vendors.id, Number(id))).returning({ id: vendors.id });
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Vendor not found' };
        }
        return { success: true, deleted: row.id };
    })

    // New API: /api/deployments/* backed by io.net CAAS
    .get('/deployments/settings', async () => {
        const settings = getIoDeploymentSettings();
        return {
            success: true,
            data: {
                enabled: settings.enabled,
                apiKeyConfigured: Boolean(settings.apiKey),
                publicBaseUrl: settings.publicBaseUrl,
                enterpriseBaseUrl: settings.enterpriseBaseUrl,
            },
        };
    })
    .put('/deployments/settings', async ({ body }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        if ('enabled' in b) await upsertOption('model_deployment.ionet.enabled', parseBooleanOption(b.enabled));
        if ('apiKey' in b || 'api_key' in b) await upsertOption('model_deployment.ionet.api_key', String(b.apiKey ?? b.api_key ?? '').trim());
        if ('publicBaseUrl' in b || 'public_base_url' in b) {
            await upsertOption('model_deployment.ionet.public_base_url', sanitizeBaseUrl(b.publicBaseUrl ?? b.public_base_url, IO_DEFAULT_PUBLIC_BASE_URL));
        }
        if ('enterpriseBaseUrl' in b || 'enterprise_base_url' in b) {
            await upsertOption('model_deployment.ionet.enterprise_base_url', sanitizeBaseUrl(b.enterpriseBaseUrl ?? b.enterprise_base_url, IO_DEFAULT_ENTERPRISE_BASE_URL));
        }
        await refreshRuntimeCaches();
        const settings = getIoDeploymentSettings();
        return {
            success: true,
            data: {
                enabled: settings.enabled,
                apiKeyConfigured: Boolean(settings.apiKey),
                publicBaseUrl: settings.publicBaseUrl,
                enterpriseBaseUrl: settings.enterpriseBaseUrl,
            },
        };
    })
    .post('/deployments/settings/test-connection', async ({ body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        const connection = await callIoApi({
            path: '/deployments',
            method: 'GET',
            enterprise: true,
            requireEnabled: false,
            apiKeyOverride: b.apiKey || b.api_key,
            query: { page: 1, page_size: 1 },
        });
        if (!connection.ok) {
            set.status = connection.status;
            return { success: false, message: parseIoApiError(connection.payload, 'Failed to connect to io.net') };
        }
        return { success: true, message: 'Connection successful' };
    })
    .post('/deployments/test-connection', async ({ body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        const connection = await callIoApi({
            path: '/deployments',
            method: 'GET',
            enterprise: true,
            requireEnabled: false,
            apiKeyOverride: b.apiKey || b.api_key,
            query: { page: 1, page_size: 1 },
        });
        if (!connection.ok) {
            set.status = connection.status;
            return { success: false, message: parseIoApiError(connection.payload, 'Failed to connect to io.net') };
        }
        return { success: true, message: 'Connection successful' };
    })
    .get('/deployments', async ({ query, set }: ElysiaCtx) => {
        const page = Math.max(Number(query?.p ?? query?.page ?? 1) || 1, 1);
        const pageSize = Math.min(Math.max(Number(query?.page_size ?? query?.pageSize ?? 20) || 20, 1), 200);
        const statusQuery = typeof query?.status === 'string' && query.status.trim() ? query.status.trim() : undefined;
        const response = await callIoApi({
            path: '/deployments',
            method: 'GET',
            enterprise: true,
            query: {
                status: statusQuery,
                page,
                page_size: pageSize,
                sort_by: query?.sort_by || 'created_at',
                sort_order: query?.sort_order || 'desc',
            },
        });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to list deployments') };
        }
        const payload = unwrapIoData(response.payload) || {};
        const rawItems = Array.isArray(payload.deployments) ? payload.deployments : (Array.isArray(payload) ? payload : []);
        const items = rawItems.map((row: Record<string, any>) => toDeploymentSummary(row));
        const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : '';
        const filtered = keyword
            ? items.filter((item: Record<string, any>) => String(item.deployment_name || '').toLowerCase().includes(keyword) || String(item.id || '').toLowerCase().includes(keyword))
            : items;
        return {
            success: true,
            data: filtered,
            total: Number(payload.total || filtered.length),
            p: page,
            page_size: pageSize,
            statusCount: computeDeploymentStatusCounts(items),
        };
    })
    .get('/deployments/search', async ({ query, set }: ElysiaCtx) => {
        const page = Math.max(Number(query?.p ?? query?.page ?? 1) || 1, 1);
        const pageSize = Math.min(Math.max(Number(query?.page_size ?? query?.pageSize ?? 20) || 20, 1), 200);
        const response = await callIoApi({
            path: '/deployments',
            method: 'GET',
            enterprise: true,
            query: {
                status: query?.status,
                page,
                page_size: pageSize,
                sort_by: query?.sort_by || 'created_at',
                sort_order: query?.sort_order || 'desc',
            },
        });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to search deployments') };
        }
        const payload = unwrapIoData(response.payload) || {};
        const rawItems = Array.isArray(payload.deployments) ? payload.deployments : (Array.isArray(payload) ? payload : []);
        const items = rawItems.map((row: Record<string, any>) => toDeploymentSummary(row));
        const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : '';
        const filtered = keyword
            ? items.filter((item: Record<string, any>) => String(item.deployment_name || '').toLowerCase().includes(keyword) || String(item.id || '').toLowerCase().includes(keyword))
            : items;
        return { success: true, data: filtered, total: filtered.length, p: page, page_size: pageSize };
    })
    .get('/deployments/hardware-types', async ({ set }: ElysiaCtx) => {
        const response = await callIoApi({ path: '/hardware/max-gpus-per-container', method: 'GET', enterprise: true });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to list hardware types') };
        }
        const payload = unwrapIoData(response.payload) || {};
        const rows = Array.isArray(payload.hardware) ? payload.hardware : [];
        const data = rows.map((row: Record<string, any>) => ({
            id: Number(row.hardware_id || 0),
            name: row.hardware_name || `Hardware ${row.hardware_id || ''}`.trim(),
            brand_name: row.brand_name || '',
            max_gpus_per_container: Number(row.max_gpus_per_container || 0),
            available: Number(row.available || 0),
        }));
        return { success: true, data, total: Number(payload.total || data.length) };
    })
    .get('/deployments/locations', async ({ set }: ElysiaCtx) => {
        const response = await callIoApi({ path: '/locations', method: 'GET', enterprise: true });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to list locations') };
        }
        const payload = unwrapIoData(response.payload) || {};
        const data = Array.isArray(payload.locations) ? payload.locations : (Array.isArray(payload) ? payload : []);
        return { success: true, data, total: Number(payload.total || data.length) };
    })
    .get('/deployments/available-replicas', async ({ query, set }: ElysiaCtx) => {
        const hardwareId = Number(query?.hardware_id || query?.hardwareId || 0);
        const hardwareQty = Number(query?.hardware_qty || query?.hardwareQty || query?.gpu_count || 1);
        if (!hardwareId) {
            set.status = 400;
            return { success: false, message: 'hardware_id is required' };
        }
        const response = await callIoApi({
            path: '/available-replicas',
            method: 'GET',
            enterprise: true,
            query: { hardware_id: hardwareId, hardware_qty: Math.max(hardwareQty, 1) },
        });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to get available replicas') };
        }
        const payload = unwrapIoData(response.payload) || [];
        const data = Array.isArray(payload) ? payload : [];
        return { success: true, data };
    })
    .post('/deployments/price-estimation', async ({ body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        const response = await callIoApi({
            path: '/price',
            method: 'GET',
            enterprise: true,
            query: {
                location_ids: normalizeIdList(b.location_ids ?? b.locationIds),
                hardware_id: Number((b.hardware_id ?? b.hardwareId) || 0),
                hardware_qty: Number(b.hardware_qty ?? b.hardwareQty ?? b.gpus_per_container ?? b.gpusPerContainer ?? 1),
                gpus_per_container: Number(b.gpus_per_container ?? b.gpusPerContainer ?? 1),
                duration_type: b.duration_type ?? b.durationType ?? 'hourly',
                duration_qty: Number(b.duration_qty ?? b.durationQty ?? 1),
                duration_hours: Number(b.duration_hours ?? b.durationHours ?? 1),
                replica_count: Number(b.replica_count ?? b.replicaCount ?? 1),
                currency: b.currency ?? 'usdc',
            },
        });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to get price estimation') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .get('/deployments/check-name', async ({ query, set }: ElysiaCtx) => {
        const clusterName = String(query?.cluster_name || query?.name || '').trim();
        if (!clusterName) {
            set.status = 400;
            return { success: false, message: 'cluster_name is required' };
        }
        const response = await callIoApi({
            path: '/clusters/check_cluster_name_availability',
            method: 'GET',
            enterprise: true,
            query: { cluster_name: clusterName },
        });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to check cluster name') };
        }
        const payload = unwrapIoData(response.payload);
        const available = typeof payload === 'boolean' ? payload : parseBooleanOption(payload);
        return { success: true, available };
    })
    .post('/deployments', async ({ body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        const response = await callIoApi({ path: '/deploy', method: 'POST', enterprise: true, body: b });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to create deployment') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .get('/deployments/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const response = await callIoApi({ path: `/deployment/${id}`, method: 'GET', enterprise: true });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to get deployment detail') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .get('/deployments/:id/logs', async ({ params: { id }, query, set }: ElysiaCtx) => {
        const containerId = String(query?.container_id || query?.containerId || '').trim();
        if (!containerId) {
            set.status = 400;
            return { success: false, message: 'container_id is required' };
        }
        const response = await callIoApi({
            path: `/deployment/${id}/log/${containerId}`,
            method: 'GET',
            enterprise: true,
            query: {
                level: query?.level,
                stream: query?.stream,
                limit: query?.limit,
                cursor: query?.cursor,
                follow: query?.follow,
                start_time: query?.start_time,
                end_time: query?.end_time,
            },
        });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to get deployment logs') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .get('/deployments/:id/containers', async ({ params: { id }, set }: ElysiaCtx) => {
        const response = await callIoApi({ path: `/deployment/${id}/containers`, method: 'GET', enterprise: true });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to list containers') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .get('/deployments/:id/containers/:container_id', async ({ params: { id, container_id }, set }: ElysiaCtx) => {
        const response = await callIoApi({ path: `/deployment/${id}/container/${container_id}`, method: 'GET', enterprise: true });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to get container details') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .put('/deployments/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        const response = await callIoApi({ path: `/deployment/${id}`, method: 'PATCH', enterprise: true, body: b });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to update deployment') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .put('/deployments/:id/name', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        const response = await callIoApi({ path: `/clusters/${id}/update-name`, method: 'PUT', enterprise: true, body: { name: b.name } });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to update deployment name') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .post('/deployments/:id/extend', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const b = (body || {}) as Record<string, any>;
        const response = await callIoApi({ path: `/deployment/${id}/extend`, method: 'POST', enterprise: true, body: b });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to extend deployment') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    })
    .delete('/deployments/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const response = await callIoApi({ path: `/deployment/${id}`, method: 'DELETE', enterprise: true });
        if (!response.ok) {
            set.status = response.status;
            return { success: false, message: parseIoApiError(response.payload, 'Failed to delete deployment') };
        }
        return { success: true, data: unwrapIoData(response.payload) };
    });

export const newApiCompatSelfRouter = new Elysia()
    .use(authPlugin)
    .get('/token', async ({ user, query, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const limit = Math.min(Number(query?.limit || 100), 200);
        const offset = Math.max(Number(query?.offset || 0), 0);
        const rows = await db.select(tokenSelfSelection).from(tokens)
            .where(eq(tokens.userId, user.id))
            .orderBy(desc(tokens.id))
            .limit(limit)
            .offset(offset);
        return rows.map(maskTokenRow);
    })
    .get('/token/search', async ({ user, query, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const keyword = (query?.keyword || '').trim();
        const tokenPart = (query?.token || '').trim().replace(/^sk-/, '');
        const conditions = [eq(tokens.userId, user.id)];
        if (keyword) conditions.push(ilike(tokens.name, `%${keyword}%`));
        if (tokenPart) conditions.push(ilike(tokens.key, `%${tokenPart}%`));
        const rows = await db.select(tokenSelfSelection).from(tokens)
            .where(and(...conditions))
            .orderBy(desc(tokens.id))
            .limit(100);
        return rows.map(maskTokenRow);
    })
    .get('/token/:id', async ({ user, params: { id }, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const [row] = await db.select(tokenSelfSelection).from(tokens)
            .where(and(eq(tokens.id, Number(id)), eq(tokens.userId, user.id)))
            .limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        return maskTokenRow(row);
    })
    .post('/token/:id/key', async ({ user, params: { id }, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const [row] = await db.select({ id: tokens.id, key: tokens.key }).from(tokens)
            .where(and(eq(tokens.id, Number(id)), eq(tokens.userId, user.id))).limit(1);
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        return { success: true, key: row.key };
    })
    .post('/token', async ({ user, body, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const b = body as Record<string, any>;
        const name = b.name || 'API Token';
        const key = b.key || `sk-${Bun.randomUUIDv7('hex')}`;
        const [row] = await db.insert(tokens).values({
            userId: user.id,
            name,
            key,
            status: Number(b.status || 1),
            remainQuota: Number(b.remainQuota ?? b.remain_quota ?? -1),
            models: b.models || null,
            subnet: b.subnet || b.allow_ips || b.allowIps || null,
            allowIps: b.allow_ips || b.allowIps || b.subnet || null,
            rateLimit: Number(b.rateLimit ?? b.rate_limit ?? 0),
            unlimitedQuota: Boolean(b.unlimitedQuota ?? b.unlimited_quota),
            modelLimitsEnabled: Boolean(b.modelLimitsEnabled ?? b.model_limits_enabled),
            tokenGroup: b.group || b.tokenGroup || b.token_group || null,
            crossGroupRetry: Boolean(b.crossGroupRetry ?? b.cross_group_retry),
            expiredAt: b.expiredAt || b.expired_at || null,
        }).returning({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            models: tokens.models,
            group: tokens.tokenGroup,
            createdAt: tokens.createdAt,
        });
        return { success: true, data: maskTokenRow(row) };
    })
    .put('/token', async ({ user, body, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const b = body as Record<string, any>;
        const id = Number(b.id);
        if (!id) {
            set.status = 400;
            return { success: false, message: 'id is required' };
        }
        const [old] = await db.select().from(tokens).where(and(eq(tokens.id, id), eq(tokens.userId, user.id))).limit(1);
        if (!old) {
            set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        const [row] = await db.update(tokens).set({
            name: b.name ?? old.name,
            status: Number(b.status ?? old.status),
            remainQuota: Number(b.remainQuota ?? b.remain_quota ?? old.remainQuota),
            models: b.models ?? old.models,
            subnet: b.subnet ?? b.allow_ips ?? b.allowIps ?? old.subnet,
            allowIps: b.allow_ips ?? b.allowIps ?? b.subnet ?? old.allowIps,
            rateLimit: Number(b.rateLimit ?? b.rate_limit ?? old.rateLimit),
            unlimitedQuota: Boolean(b.unlimitedQuota ?? b.unlimited_quota ?? old.unlimitedQuota),
            modelLimitsEnabled: Boolean(b.modelLimitsEnabled ?? b.model_limits_enabled ?? old.modelLimitsEnabled),
            tokenGroup: b.group ?? b.tokenGroup ?? b.token_group ?? old.tokenGroup,
            crossGroupRetry: Boolean(b.crossGroupRetry ?? b.cross_group_retry ?? old.crossGroupRetry),
            expiredAt: b.expiredAt ?? b.expired_at ?? old.expiredAt,
            updatedAt: new Date(),
        }).where(and(eq(tokens.id, id), eq(tokens.userId, user.id))).returning({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            models: tokens.models,
            group: tokens.tokenGroup,
            updatedAt: tokens.updatedAt,
        });
        await sql`SELECT pg_notify('auth_update', ${old.key})`.catch(() => {});
        return { success: true, data: maskTokenRow(row) };
    })
    .delete('/token/:id', async ({ user, params: { id }, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const [row] = await db.delete(tokens).where(and(eq(tokens.id, Number(id)), eq(tokens.userId, user.id))).returning({ id: tokens.id, key: tokens.key });
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        await sql`SELECT pg_notify('auth_update', ${row.key})`.catch(() => {});
        return { success: true, deleted: row.id };
    })
    .post('/token/batch', async ({ user, body, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const ids = normalizeIdList((body as Record<string, any>)?.ids);
        if (ids.length === 0) {
            set.status = 400;
            return { success: false, message: 'No token IDs provided' };
        }
        const rows = await db.delete(tokens).where(and(eq(tokens.userId, user.id), inArray(tokens.id, ids))).returning({ id: tokens.id, key: tokens.key });
        for (const row of rows) await sql`SELECT pg_notify('auth_update', ${row.key})`.catch(() => {});
        return { success: true, deleted: rows.length };
    })
    .post('/token/batch/keys', async ({ user, body, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const ids = normalizeIdList((body as Record<string, any>)?.ids);
        if (ids.length === 0) {
            set.status = 400;
            return { success: false, message: 'No token IDs provided' };
        }
        const rows = await db.select({ id: tokens.id, key: tokens.key }).from(tokens).where(and(eq(tokens.userId, user.id), inArray(tokens.id, ids)));
        const keys: Record<number, string> = {};
        for (const row of rows) keys[row.id] = row.key;
        return { success: true, keys };
    })
    .get('/usage/token', async ({ token, set }: ElysiaCtx) => {
        if (!token?.id) {
            set.status = 401;
            return { success: false, message: 'Token authentication required' };
        }
        const [row] = await db.select({
            id: tokens.id,
            name: tokens.name,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            unlimitedQuota: tokens.unlimitedQuota,
            accessedAt: tokens.accessedAt,
        }).from(tokens).where(eq(tokens.id, token.id)).limit(1);
        const [stats] = await db.select({
            totalRequests: count(),
            totalCost: drizzleSql`COALESCE(SUM(${logs.quotaCost}), 0)`,
            promptTokens: drizzleSql`COALESCE(SUM(${logs.promptTokens}), 0)`,
            completionTokens: drizzleSql`COALESCE(SUM(${logs.completionTokens}), 0)`,
            lastUsed: max(logs.createdAt),
        }).from(logs).where(eq(logs.tokenId, token.id));
        return { success: true, token: row, stats };
    })
    .get('/log/self/stat', async ({ user, query, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const hours = Number(query?.hours) || 24;
        const [stats] = await db.select({
            totalRequests: count(),
            successCount: drizzleSql`COUNT(CASE WHEN ${logs.statusCode} < 400 THEN 1 END)`,
            totalCost: drizzleSql`COALESCE(SUM(${logs.quotaCost}), 0)`,
            totalTokens: drizzleSql`COALESCE(SUM(${logs.promptTokens} + ${logs.completionTokens}), 0)`,
            uniqueModels: drizzleSql`COUNT(DISTINCT ${logs.modelName})`,
        }).from(logs)
            .where(and(eq(logs.userId, user.id), drizzleSql`created_at > NOW() - ${hours}::int * INTERVAL '1 hour'`));
        return stats || {};
    })
    .get('/log/self', async ({ user, query, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const page = Number(query?.page) || 1;
        const limit = Math.min(Number(query?.limit) || 50, 200);
        const offset = (page - 1) * limit;
        const [countRow] = await db.select({ total: drizzleSql<number>`count(*)` }).from(logs).where(eq(logs.userId, user.id));
        const data = await db.select({
            id: logs.id,
            modelName: logs.modelName,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            quotaCost: logs.quotaCost,
            statusCode: logs.statusCode,
            isStream: logs.isStream,
            createdAt: logs.createdAt,
            channelId: logs.channelId,
            errorMessage: logs.errorMessage,
            elapsedMs: logs.elapsedMs,
        }).from(logs).where(eq(logs.userId, user.id)).orderBy(desc(logs.createdAt)).limit(limit).offset(offset);
        return { data, total: Number(countRow?.total || 0), page, limit };
    })
    .get('/log/self/search', async ({ user, query, set }: ElysiaCtx) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Authentication required' };
        }
        const keyword = (query?.keyword || '').trim();
        const model = query?.model;
        const page = Number(query?.page) || 1;
        const limit = Math.min(Number(query?.limit) || 50, 200);
        const offset = (page - 1) * limit;
        const selfSearchConditions = [eq(logs.userId, user.id)];
        if (keyword) selfSearchConditions.push(ilike(logs.modelName, `%${keyword}%`));
        if (model) selfSearchConditions.push(eq(logs.modelName, model));
        const [countRow] = await db.select({ total: count() }).from(logs)
            .where(and(...selfSearchConditions));
        const data = await db.select({
            id: logs.id,
            modelName: logs.modelName,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            quotaCost: logs.quotaCost,
            statusCode: logs.statusCode,
            isStream: logs.isStream,
            createdAt: logs.createdAt,
            errorMessage: logs.errorMessage,
            elapsedMs: logs.elapsedMs,
        }).from(logs)
            .where(and(...selfSearchConditions))
            .orderBy(desc(logs.createdAt))
            .limit(limit)
            .offset(offset);
        return { data, total: Number(countRow?.total || 0), page, limit };
    })
    .get('/log/token', async ({ token, query, set }: ElysiaCtx) => {
        if (!token?.id) {
            set.status = 401;
            return { success: false, message: 'Token authentication required' };
        }
        const page = Number(query?.page) || 1;
        const limit = Math.min(Number(query?.limit) || 50, 200);
        const offset = (page - 1) * limit;
        const [countRow] = await db.select({ total: drizzleSql<number>`count(*)` }).from(logs).where(eq(logs.tokenId, token.id));
        const data = await db.select({
            id: logs.id,
            modelName: logs.modelName,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            quotaCost: logs.quotaCost,
            statusCode: logs.statusCode,
            isStream: logs.isStream,
            createdAt: logs.createdAt,
            elapsedMs: logs.elapsedMs,
        }).from(logs).where(eq(logs.tokenId, token.id)).orderBy(desc(logs.createdAt)).limit(limit).offset(offset);
        return { data, total: Number(countRow?.total || 0), page, limit };
    });
