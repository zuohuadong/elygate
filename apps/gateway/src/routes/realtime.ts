import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { log } from '../services/logger';
import { memoryCache } from '../services/cache';
import { sql } from '@elygate/db';
import { calculateCost } from '../services/ratio';
import type { TokenRecord, UserRecord } from '../types';

function notImplemented(set: Record<string, any>, msg: string) {
    set.status = 501;
    return { error: { message: msg, type: 'not_implemented' } };
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

                    const channels = memoryCache.selectChannels('gpt-4o-realtime', u.group);
                    const channel = channels?.[0];
                    if (!channel) { ws.close(4004, 'No available channel for realtime'); return; }

                    const baseUrl = channel.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
                    const upstreamUrl = `${baseUrl}/v1/realtime`;
                    const model = 'gpt-4o-realtime';

                    log.info(`[Realtime/WS] UserID: ${u.id}, Channel: ${channel.name}, Upstream: ${upstreamUrl}`);

                    const upstreamHeaders: Record<string, string> = {
                        'Authorization': `Bearer ${channel.key.split('\n')[0]}`,
                        'OpenAI-Beta': 'realtime=v1',
                    };
                    if (channel.openaiOrganization) {
                        upstreamHeaders['OpenAI-Organization'] = channel.openaiOrganization;
                    }

                    // Bun WebSocket constructor: new WebSocket(url, protocols?, options?)
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
                        const cost = calculateCost(model, u.group, estimatedTokens, 0);
                        if (cost > 0) {
                            sql`UPDATE users SET used_quota = used_quota + ${cost} WHERE id = ${u.id}`.catch(() => {});
                            sql`UPDATE tokens SET used_quota = used_quota + ${cost}, accessed_at = NOW() WHERE id = ${t.id}`.catch(() => {});
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
    .post('/realtime/sessions', async ({ set }: ElysiaCtx) => notImplemented(set, 'Realtime session creation is not implemented. Use WebSocket connection directly.'))
    .post('/realtime/transcription_sessions', async ({ set }: ElysiaCtx) => notImplemented(set, 'Realtime transcription sessions are not implemented. Use WebSocket connection directly.'));
