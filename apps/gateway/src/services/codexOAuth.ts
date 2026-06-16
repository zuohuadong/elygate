import { config } from '../config';
import { log } from './logger';

/**
 * Codex / io.net OAuth 集成
 * 对标 new-api 的 Codex OAuth 流程，用于获取 io.net 的 API 凭证。
 * 流程：
 * 1. start: 生成授权 URL，管理员在浏览器中授权
 * 2. complete: 用回调的 code 换取 access_token + refresh_token
 * 3. refresh: 使用 refresh_token 刷新过期的 access_token
 * 4. usage: 查询 io.net 用量
 */

const IONET_AUTH_BASE = 'https://auth.io.net';
const IONET_API_BASE = 'https://api.io.net';

interface CodexOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

function getCodexOAuthConfig(): CodexOAuthConfig | null {
    const clientId = process.env.CODEX_OAUTH_CLIENT_ID || process.env.IONET_CLIENT_ID || '';
    const clientSecret = process.env.CODEX_OAUTH_CLIENT_SECRET || process.env.IONET_CLIENT_SECRET || '';
    const redirectUri = process.env.CODEX_OAUTH_REDIRECT_URI || `${config.gatewayUrl}/api/admin/channel/codex/oauth/callback`;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, redirectUri };
}

/**
 * 生成 OAuth 授权 URL
 */
export function createCodexOAuthStartUrl(state: string): { url: string; config: CodexOAuthConfig } | null {
    const cfg = getCodexOAuthConfig();
    if (!cfg) return null;
    const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: 'read write',
        state,
    });
    return {
        url: `${IONET_AUTH_BASE}/oauth/authorize?${params.toString()}`,
        config: cfg,
    };
}

/**
 * 用授权码换取 access_token
 */
export async function exchangeCodexOAuthCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    scope: string;
} | null> {
    const cfg = getCodexOAuthConfig();
    if (!cfg) return null;

    try {
        const res = await fetch(`${IONET_AUTH_BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: cfg.clientId,
                client_secret: cfg.clientSecret,
                redirect_uri: cfg.redirectUri,
            }),
        });
        const data = await res.json() as Record<string, any>;
        if (!data.access_token) {
            log.error('[CodexOAuth] Token exchange failed:', data);
            return null;
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: Number(data.expires_in || 3600),
            scope: data.scope || '',
        };
    } catch (e: unknown) {
        log.error('[CodexOAuth] Token exchange error:', e);
        return null;
    }
}

/**
 * 刷新 access_token
 */
export async function refreshCodexToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
} | null> {
    const cfg = getCodexOAuthConfig();
    if (!cfg) return null;

    try {
        const res = await fetch(`${IONET_AUTH_BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: cfg.clientId,
                client_secret: cfg.clientSecret,
            }),
        });
        const data = await res.json() as Record<string, any>;
        if (!data.access_token) {
            log.error('[CodexOAuth] Token refresh failed:', data);
            return null;
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresIn: Number(data.expires_in || 3600),
        };
    } catch (e: unknown) {
        log.error('[CodexOAuth] Token refresh error:', e);
        return null;
    }
}

/**
 * 查询 io.net 用量
 */
export async function getCodexUsage(accessToken: string): Promise<Record<string, any> | null> {
    try {
        const res = await fetch(`${IONET_API_BASE}/v1/usage`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (!res.ok) {
            log.error(`[CodexOAuth] Usage query failed: HTTP ${res.status}`);
            return null;
        }
        return await res.json() as Record<string, any>;
    } catch (e: unknown) {
        log.error('[CodexOAuth] Usage query error:', e);
        return null;
    }
}

export function isCodexOAuthConfigured(): boolean {
    return !!getCodexOAuthConfig();
}
