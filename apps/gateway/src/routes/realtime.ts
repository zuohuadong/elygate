import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { log } from '../services/logger';
import { memoryCache } from '../services/cache';
import { optionCache } from '../services/optionCache';
import { db, sql } from '@elygate/db';
import { users, tokens } from '@elygate/db/schema';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { calculateCost } from '../services/ratio';
import type { TokenRecord, UserRecord } from '../types';
import { getProviderHandler } from '../providers';
import { getChannelKeys } from '../services/encryption';

function normalizeObject(value: unknown): Record<string, any> {
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

function setHeader(headers: Headers, key: string, value: unknown) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
}

function getRealtimeModel(input?: Record<string, any> | URL): string {
    if (input instanceof URL) {
        return input.searchParams.get('model') || 'gpt-4o-realtime';
    }
    return input?.model || input?.session?.model || 'gpt-4o-realtime';
}

function chooseRealtimeChannel(user: UserRecord, token: TokenRecord, model: string) {
    const explicitGroup = token.tokenGroup || user.group;
    const groups = explicitGroup === 'auto'
        ? (optionCache.get('AutoGroups', ['default']) as string[])
        : [explicitGroup || 'default'];

    for (const group of groups) {
        const candidates = memoryCache.selectChannels(model, group);
        if (candidates?.length > 0) return { channel: candidates[0], group };
    }

    const fallback = memoryCache.selectChannels('gpt-4o-realtime', user.group || 'default');
    return fallback?.[0] ? { channel: fallback[0], group: user.group || 'default' } : null;
}

function buildRealtimeHeaders(channel: Record<string, any>, activeKey: string) {
    const handler = getProviderHandler(channel.type, channel.baseUrl);
    const headers = handler.buildHeaders(activeKey);
    setHeader(headers, 'OpenAI-Beta', 'realtime=v1');
    if (channel.openaiOrganization) setHeader(headers, 'OpenAI-Organization', channel.openaiOrganization);
    const overrides = normalizeObject(channel.headerOverride);
    for (const [key, value] of Object.entries(overrides)) setHeader(headers, key, value);
    return headers;
}

async function proxyRealtimeSession(kind: 'sessions' | 'transcription_sessions', ctx: ElysiaCtx) {
    const { body, user, token, set } = ctx;
    const model = getRealtimeModel(body as Record<string, any>);
    const selected = chooseRealtimeChannel(user as UserRecord, token as TokenRecord, model);
    if (!selected) {
        set.status = 503;
        return { error: { message: `No available realtime channel for ${model}`, type: 'server_error' } };
    }

    const keys = getChannelKeys(selected.channel.key);
    const activeKey = keys[0] || '';
    const baseUrl = selected.channel.baseUrl.replace(/\/+$/, '');
    const upstreamUrl = `${baseUrl}/v1/realtime/${kind}`;
    const headers = buildRealtimeHeaders(selected.channel, activeKey);

    try {
        const res = await fetch(upstreamUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body || { model })
        });
        const text = await res.text();
        set.status = res.status;
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    } catch (error: unknown) {
        set.status = 502;
        return { error: { message: error instanceof Error ? error.message : String(error), type: 'upstream_error' } };
    }
}

export const realtimeRouter = new Elysia()
    .get('/realtime', async ({ request, set }: ElysiaCtx) => {
        const upgrade = request.headers.get('upgrade');
        if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
            set.status = 400;
            return { error: { message: 'Realtime endpoint requires WebSocket upgrade', type: 'invalid_request' } };
        }
        set.status = 426;
        return { error: { message: 'Upgrade required: use WebSocket protocol', type: 'upgrade_required' } };
    })
    .ws('/realtime', {
        open(ws) {
            const url = new URL(ws.data.request.url);
            const authHeader = ws.data.request.headers.get('authorization') || '';
            const apiKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : url.searchParams.get('key') || '';

            if (!apiKey) {
                ws.close(4001, 'Missing API key');
                return;
            }

            (async () => {
                try {
                    const t = await memoryCache.getTokenFromCache(apiKey);
                    if (!t || t.status !== 1) { ws.close(4003, 'Invalid API key'); return; }
                    const u = await memoryCache.getUserFromDB(t.userId);
                    if (!u) { ws.close(4003, 'User not found'); return; }

                    const model = getRealtimeModel(url);
                    const selected = chooseRealtimeChannel(u, t, model);
                    if (!selected) { ws.close(4004, 'No available channel for realtime'); return; }
                    const { channel, group } = selected;

                    const baseUrl = channel.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
                    const upstreamUrl = `${baseUrl}/v1/realtime?model=${encodeURIComponent(model)}`;

                    log.info(`[Realtime/WS] UserID: ${u.id}, Channel: ${channel.name}, Upstream: ${upstreamUrl}`);

                    const keys = getChannelKeys(channel.key);
                    const upstreamHeaders = buildRealtimeHeaders(channel, keys[0] || '');

                    const upstreamWs = new WebSocket(upstreamUrl, { headers: upstreamHeaders } as any);

                    let startTime = Date.now();
                    let messageCount = 0;

                    upstreamWs.onopen = () => {
                        ws.subscribe(`realtime:${t.id}`);
                    };

                    upstreamWs.onmessage = (event: MessageEvent) => {
                        messageCount++;
                        try { ws.send(typeof event.data === 'string' ? event.data : JSON.stringify(event.data)); } catch {}
                    };

                    upstreamWs.onerror = () => {
                        log.error(`[Realtime/WS] Upstream error for channel ${channel.id}`);
                        try { ws.close(1011, 'Upstream error'); } catch {}
                    };

                    upstreamWs.onclose = (event: CloseEvent) => {
                        const elapsed = Date.now() - startTime;
                        const estimatedTokens = messageCount * 50;
                        const cost = calculateCost(model, group, estimatedTokens, 0);
                        if (cost > 0) {
                            db.update(users).set({ usedQuota: drizzleSql`${users.usedQuota} + ${cost}` }).where(eq(users.id, u.id)).catch(() => {});
                            db.update(tokens).set({ usedQuota: drizzleSql`${tokens.usedQuota} + ${cost}`, accessedAt: new Date() }).where(eq(tokens.id, t.id)).catch(() => {});
                        }
                        log.info(`[Realtime/WS] Session ended: ${elapsed}ms, ${messageCount} messages`);
                        try { ws.close(event.code, event.reason); } catch {}
                    };

                    (ws.data as any).__upstreamWs = upstreamWs;
                    (ws.data as any).__realtimeUser = u;
                    (ws.data as any).__realtimeToken = t;
                } catch (err) {
                    log.error(`[Realtime/WS] Setup error: ${err}`);
                    try { ws.close(1011, 'Internal error'); } catch {}
                }
            })();
        },
        message(ws, message: any) {
            const upstream = (ws.data as any).__upstreamWs as WebSocket | undefined;
            if (upstream && upstream.readyState === WebSocket.OPEN) {
                upstream.send(typeof message === 'string' ? message : JSON.stringify(message));
            }
        },
        close(ws: any, code: number, reason: string) {
            const upstream = ws?.data?.__upstreamWs as WebSocket | undefined;
            if (upstream) { try { upstream.close(code, reason); } catch {} }
        },
    })
    .post('/realtime/sessions', async (ctx: ElysiaCtx) => proxyRealtimeSession('sessions', ctx))
    .post('/realtime/transcription_sessions', async (ctx: ElysiaCtx) => proxyRealtimeSession('transcription_sessions', ctx));
