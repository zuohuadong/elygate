import type { ElysiaCtx } from '../types';
import { config, apiUrls } from '../config';
import { Elysia, t } from 'elysia';
import { db, sql } from '@elygate/db';
import {
    users, tokens, sessions, inviteCodes, loginAttempts,
    logs as logsTable, packages as packagesTable,
    userSubscriptions, oauthAccounts,
} from '@elygate/db/schema';
import {
    eq, and, desc, asc, count, sql as drizzleSql

} from 'drizzle-orm';
import { authService } from '../services/auth';
import { authPlugin } from '../middleware/auth';
import type { UserRecord  } from '../types';
import { getLangFromHeader } from '../utils/i18n';
import { optionCache } from '../services/optionCache';
import { memoryCache } from '../services/cache';

const GITHUB_CLIENT_ID = config.github.clientId || '';
const GITHUB_CLIENT_SECRET = config.github.clientSecret || '';
const REDIRECT_URI = config.github.redirectUri || 'http://localhost:3000/api/auth/github/callback';

const DISCORD_CLIENT_ID = config.discord.clientId || '';
const DISCORD_CLIENT_SECRET = config.discord.clientSecret || '';
const DISCORD_REDIRECT_URI = config.discord.redirectUri || 'http://localhost:3000/api/auth/discord/callback';

const TELEGRAM_BOT_TOKEN = config.telegram.botToken || '';

import { jwt } from '@elysiajs/jwt';

export const authRouter = new Elysia()
    .use(jwt({
        name: 'jwt',
        secret: config.jwtSecret!,
        exp: '7d'
    }))
    .get('/github', ({ set }) => {
        const url = `${apiUrls.github.authorize}?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=read:user`;
        set.redirect = url;
    })
    .get('/github/callback', async ({ query, set }) => {
        const { code } = query;
        if (!code) throw new Error("No code provided");

        // 1. Exchange code for access token
        const tokenRes = await fetch(apiUrls.github.accessToken, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code: code
            })
        });

        const tokenData = await tokenRes.json() as Record<string, any>;
        if (tokenData.error) throw new Error(tokenData.error_description || "GitHub auth failed");

        const accessToken = tokenData.access_token;

        // 2. Fetch user info
        const userRes = await fetch(apiUrls.github.user, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'User-Agent': 'elygate-server'
            }
        });

        const githubUser = await userRes.json() as Record<string, any>;

        // 3. Get or Create user in our DB
        const user = await authService.getOrCreateGithubUser(githubUser.id.toString(), githubUser.login);

        // 4. Generate local session
        const sessionToken = await authService.generateSessionToken(user.id);

        const targetUrl = config.webUrl || 'http://localhost:5173';
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}&role=${user.role}`;
    })
    // User registration
    .post('/register', async ({ body, set, request }: ElysiaCtx) => {
        const lang = getLangFromHeader(request.headers.get('accept-language'));
        try {
            const { username, password, inviteCode } = body;
            if (!username || !password) {
                set.status = 400;
                return { success: false, message: lang === 'zh' ? '用户名和密码不能为空' : 'Username and password are required' };
            }

            const registerMode = String(optionCache.get('RegisterMode', 'open'));
            const defaultQuota = parseInt(optionCache.get('SignRegisterQuota', '500000')) || 500000;

            if (registerMode === 'closed') {
                set.status = 403;
                return { success: false, message: lang === 'zh' ? '注册功能已关闭' : 'Registration is currently disabled' };
            }

            let giftQuota = 0;
            let inviteCodeRecord = null;

            if (inviteCode) {
                const [codeRecord] = await db
                    .select()
                    .from(inviteCodes)
                    .where(eq(inviteCodes.code, inviteCode))
                    .limit(1);

                if (!codeRecord) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码无效' : 'Invalid invite code' };
                }

                if (codeRecord.status !== 1) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码已禁用' : 'Invite code is disabled' };
                }

                if (codeRecord.expiresAt && new Date(codeRecord.expiresAt) < new Date()) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码已过期' : 'Invite code has expired' };
                }

                if (codeRecord.usedCount >= codeRecord.maxUses) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码使用次数已达上限' : 'Invite code usage limit reached' };
                }

                giftQuota = codeRecord.giftQuota || 0;
                inviteCodeRecord = codeRecord;
            } else if (registerMode === 'invite') {
                set.status = 400;
                return { success: false, message: lang === 'zh' ? '注册需要邀请码' : 'Invite code is required for registration' };
            }

            // Check if user exists
            const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
            if (existing) {
                set.status = 409;
                return { success: false, message: lang === 'zh' ? '用户名已存在' : 'Username already exists' };
            }

            // Hash password
            const passwordHash = await Bun.password.hash(password);
            const totalQuota = defaultQuota + giftQuota;

            // Create user
            const [user] = await db
                .insert(users)
                .values({
                    username,
                    passwordHash,
                    role: 1,
                    quota: totalQuota,
                    status: 1,
                })
                .returning({
                    id: users.id,
                    username: users.username,
                    role: users.role,
                });

            if (inviteCodeRecord) {
                await db
                    .update(inviteCodes)
                    .set({
                        usedCount: drizzleSql`${inviteCodes.usedCount} + 1`,
                        updatedAt: drizzleSql`NOW()`,
                    })
                    .where(eq(inviteCodes.id, inviteCodeRecord.id));
            }

            // Create default token
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await db.insert(tokens).values({
                userId: user.id,
                name: 'Default API Key',
                key: newKey,
                status: 1,
                remainQuota: -1,
            });

            return {
                success: true,
                message: lang === 'zh' ? '注册成功' : 'Registration successful',
                data: {
                    username: user.username,
                    role: user.role,
                    giftQuota: giftQuota > 0 ? giftQuota : undefined
                }
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: (e as any)?.message || (lang === 'zh' ? '服务器内部错误' : 'Internal server error') };
        }
    })
    // Login route
    .post('/login', async ({ body, set, request, cookie: { auth_session } }: ElysiaCtx) => {
        const lang = getLangFromHeader(request.headers.get('accept-language'));
        const clientIP = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

        try {
            const { username, password } = body;
            if (!username || !password) {
                set.status = 400;
                return { success: false, message: lang === 'zh' ? '用户名和密码不能为空' : 'Username and password are required' };
            }

            const [user] = await db
                .select({
                    id: users.id,
                    username: users.username,
                    passwordHash: users.passwordHash,
                    role: users.role,
                    status: users.status,
                    lockedUntil: users.lockedUntil,
                    currency: users.currency,
                })
                .from(users)
                .where(eq(users.username, username))
                .limit(1);
            if (!user) {
                await db.insert(loginAttempts).values({ username, ipAddress: clientIP, success: false });
                set.status = 401;
                return { success: false, message: lang === 'zh' ? '用户名或密码错误' : 'Invalid username or password' };
            }

            if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
                const remainingMinutes = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
                set.status = 403;
                return { success: false, message: lang === 'zh' ? `账户已被锁定，请 ${remainingMinutes} 分钟后重试` : `Account is locked` };
            }

            if (user.status !== 1) {
                set.status = 403;
                return { success: false, message: lang === 'zh' ? '账户已被禁用' : 'Account is disabled' };
            }

            let isValid = false;
            try { isValid = await Bun.password.verify(password, user.passwordHash); } catch (_) { isValid = false; }

            if (!isValid) {
                await db.insert(loginAttempts).values({ username, ipAddress: clientIP, success: false });
                set.status = 401;
                return { success: false, message: lang === 'zh' ? '用户名或密码错误' : 'Invalid username or password' };
            }

            await db.delete(loginAttempts).where(eq(loginAttempts.username, username));
            const sessionToken = `sess_${Bun.randomUUIDv7('hex')}${Bun.randomUUIDv7('hex')}`;
            const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);
            await db.insert(sessions).values({
                id: Bun.randomUUIDv7('hex'),
                userId: user.id,
                token: sessionToken,
                expiresAt,
                ipAddress: clientIP,
                userAgent: request.headers.get('user-agent') || 'unknown',
            });

            auth_session.set({
                value: sessionToken,
                httpOnly: true,
                secure: request.headers.get('x-forwarded-proto') === 'https',
                sameSite: 'lax',
                maxAge: 7 * 86400,
                path: '/'
            });

            let [tokenRow] = await db
                .select({ key: tokens.key })
                .from(tokens)
                .where(and(eq(tokens.userId, user.id), eq(tokens.status, 1)))
                .orderBy(asc(tokens.id))
                .limit(1);
            if (!tokenRow) {
                const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
                [tokenRow] = await db
                    .insert(tokens)
                    .values({ userId: user.id, name: 'Default API Key', key: newKey, status: 1, remainQuota: -1 })
                    .returning({ key: tokens.key });
            }

            return { success: true, token: tokenRow.key, username: user.username, role: user.role, currency: user.currency || 'USD' };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: (e as any)?.message || 'Internal server error' };
        }
    })
    .post('/logout', async ({ cookie: { auth_session } }: ElysiaCtx) => {
        if (auth_session.value) { await db.delete(sessions).where(eq(sessions.token, auth_session.value)); }
        auth_session.remove();
        return { success: true, message: 'Logged out successfully' };
    })

    // --- Authenticated Consumer Endpoints ---
    .group('', (app) =>
        app.use(authPlugin)
            // Support both old and new (standardized) user dashboard paths
            .group('/user', (app) =>
                app.get('/info', async ({ user }: ElysiaCtx) => {
                    const u = user as UserRecord;
                    return {
                        id: u.id,
                        username: u.username,
                        role: u.role,
                        quota: u.quota,
                        usedQuota: u.usedQuota,
                        group: u.group,
                        currency: u.currency || 'USD'
                    };
                })
                .get('/logs', async ({ query, user }: ElysiaCtx) => {
                    const userRow = user as UserRecord;
                    const page = Number(query?.page) || 1;
                    const limit = Number(query?.limit) || 50;
                    const offset = (page - 1) * limit;
                    const [countRow] = await db.select({ total: count() }).from(logsTable).where(eq(logsTable.userId, userRow.id));
                    const data = await db
                        .select({
                            id: logsTable.id,
                            modelName: logsTable.modelName,
                            promptTokens: logsTable.promptTokens,
                            completionTokens: logsTable.completionTokens,
                            quotaCost: logsTable.quotaCost,
                            createdAt: logsTable.createdAt,
                            isStream: logsTable.isStream,
                            elapsedMs: logsTable.elapsedMs,
                        })
                        .from(logsTable)
                        .where(eq(logsTable.userId, userRow.id))
                        .orderBy(desc(logsTable.createdAt))
                        .limit(limit)
                        .offset(offset);
                    return { data, total: countRow.total, page, limit };
                })
                .get('/tokens', async ({ user }: ElysiaCtx) => {
                    const userRow = user as UserRecord;
                    const data = await db
                        .select({
                            id: tokens.id,
                            name: tokens.name,
                            key: tokens.key,
                            status: tokens.status,
                            remainQuota: tokens.remainQuota,
                            usedQuota: tokens.usedQuota,
                            createdAt: tokens.createdAt,
                            models: tokens.models,
                            subnet: tokens.subnet,
                            allowIps: tokens.allowIps,
                            rateLimit: tokens.rateLimit,
                            expiredAt: tokens.expiredAt,
                            unlimitedQuota: tokens.unlimitedQuota,
                            modelLimitsEnabled: tokens.modelLimitsEnabled,
                            tokenGroup: tokens.tokenGroup,
                            crossGroupRetry: tokens.crossGroupRetry,
                            accessedAt: tokens.accessedAt,
                        })
                        .from(tokens)
                        .where(eq(tokens.userId, userRow.id))
                        .orderBy(desc(tokens.id));
                    return [...data];
                })
                .get('/packages', async ({ user }: ElysiaCtx) => {
                    const userRow = user as UserRecord;
                    const userGroup = userRow.group || 'default';
                    const data = await db
                        .select({
                            id: packagesTable.id,
                            name: packagesTable.name,
                            description: packagesTable.description,
                            price: packagesTable.price,
                            durationDays: packagesTable.durationDays,
                            models: packagesTable.models,
                            allowedGroups: packagesTable.allowedGroups,
                        })
                        .from(packagesTable)
                        .where(eq(packagesTable.isPublic, true))
                        .orderBy(asc(packagesTable.price));
                    return data.filter((pkg: Record<string, any>) => {
                        const allowedGroups = Array.isArray(pkg.allowedGroups) ? pkg.allowedGroups : (typeof pkg.allowedGroups === 'string' ? JSON.parse(pkg.allowedGroups || '[]') : []);
                        if (allowedGroups.length > 0 && !allowedGroups.includes(userGroup)) return false;
                        const policy = memoryCache.userGroups.get(userGroup);
                        if (policy && policy.allowedPackages?.length > 0 && !policy.allowedPackages.includes(pkg.id)) return false;
                        return true;
                    });
                })
                .get('/subscriptions', async ({ user }: ElysiaCtx) => {
                    const userRow = user as UserRecord;
                    return await db
                        .select({
                            id: userSubscriptions.id,
                            packageId: userSubscriptions.packageId,
                            packageName: packagesTable.name,
                            models: packagesTable.models,
                            startTime: userSubscriptions.startTime,
                            endTime: userSubscriptions.endTime,
                            status: userSubscriptions.status,
                        })
                        .from(userSubscriptions)
                        .innerJoin(packagesTable, eq(userSubscriptions.packageId, packagesTable.id))
                        .where(and(eq(userSubscriptions.userId, userRow.id), eq(userSubscriptions.status, 1)))
                        .orderBy(desc(userSubscriptions.endTime));
                })
                .post('/tokens', async ({ body, user }: ElysiaCtx) => {
                    const userRow = user as UserRecord;
                    const b = body as Record<string, any>;
                    const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
                    const [result] = await db
                        .insert(tokens)
                        .values({
                            userId: userRow.id,
                            name: b.name,
                            key: newKey,
                            status: 1,
                            remainQuota: b.remainQuota || -1,
                            models: b.models || [],
                            subnet: b.subnet || b.allowIps || null,
                            allowIps: b.allowIps || b.subnet || null,
                            rateLimit: b.rateLimit || 0,
                            expiredAt: b.expiredAt || null,
                            unlimitedQuota: Boolean(b.unlimitedQuota),
                            modelLimitsEnabled: Boolean(b.modelLimitsEnabled),
                        })
                        .returning();
                    return result;
                })
                .put('/tokens/:id', async ({ params: { id }, body, user, set }: ElysiaCtx) => {
                    const userRow = user as UserRecord;
                    const [existing] = await db.select({ id: tokens.id }).from(tokens).where(and(eq(tokens.id, Number(id)), eq(tokens.userId, userRow.id)));
                    if (!existing) { set.status = 403; throw new Error('Forbidden'); }
                    const [result] = await db
                        .update(tokens)
                        .set({
                            name: drizzleSql`COALESCE(${body.name}, ${tokens.name})`,
                            status: drizzleSql`COALESCE(${body.status}, ${tokens.status})`,
                            remainQuota: drizzleSql`COALESCE(${body.remainQuota}, ${tokens.remainQuota})`,
                            models: drizzleSql`COALESCE(${body.models || null}, ${tokens.models})`,
                            subnet: drizzleSql`COALESCE(${body.subnet || body.allowIps || null}, ${tokens.subnet})`,
                            allowIps: drizzleSql`COALESCE(${body.allowIps || body.subnet || null}, ${tokens.allowIps})`,
                            rateLimit: drizzleSql`COALESCE(${body.rateLimit}, ${tokens.rateLimit})`,
                            expiredAt: drizzleSql`COALESCE(${body.expiredAt}, ${tokens.expiredAt})`,
                            unlimitedQuota: drizzleSql`COALESCE(${body.unlimitedQuota}, ${tokens.unlimitedQuota})`,
                            modelLimitsEnabled: drizzleSql`COALESCE(${body.modelLimitsEnabled}, ${tokens.modelLimitsEnabled})`,
                            updatedAt: drizzleSql`NOW()`,
                        })
                        .where(and(eq(tokens.id, Number(id)), eq(tokens.userId, userRow.id)))
                        .returning();
                    return result;
                })
                .delete('/tokens/:id', async ({ params: { id }, user, set }: ElysiaCtx) => {
                    const userRow = user as UserRecord;
                    const [result] = await db.delete(tokens).where(and(eq(tokens.id, Number(id)), eq(tokens.userId, userRow.id))).returning();
                    if (!result) { set.status = 403; throw new Error('Forbidden'); }
                    return { success: true, deleted: result };
                })
            )
            .get('/stats', async ({ user }: ElysiaCtx) => {
                const userRow = user as UserRecord;
                return await db
                    .select({
                        date: drizzleSql`DATE(${logsTable.createdAt})`.as('date'),
                        total_tokens: drizzleSql`SUM(${logsTable.promptTokens} + ${logsTable.completionTokens})`.as('total_tokens'),
                        total_cost: drizzleSql`SUM(${logsTable.quotaCost})`.as('total_cost'),
                        request_count: count().as('request_count'),
                    })
                    .from(logsTable)
                    .where(
                        and(
                            eq(logsTable.userId, userRow.id),
                            drizzleSql`${logsTable.createdAt} >= NOW() - INTERVAL '14 days'`
                        )
                    )
                    .groupBy(drizzleSql`DATE(${logsTable.createdAt})`)
                    .orderBy(asc(drizzleSql`DATE(${logsTable.createdAt})`));
            })
            .get('/realtime', async ({ user }: ElysiaCtx) => {
                const userRow = user as UserRecord;
                const [realtime] = await db
                    .select({
                        rpm: count().as('rpm'),
                        tpm: drizzleSql`COALESCE(SUM(${logsTable.promptTokens} + ${logsTable.completionTokens}), 0)`.as('tpm'),
                    })
                    .from(logsTable)
                    .where(
                        and(
                            eq(logsTable.userId, userRow.id),
                            drizzleSql`${logsTable.createdAt} >= NOW() - INTERVAL '1 minute'`
                        )
                    );
                return { rpm: Number(realtime.rpm || 0), tpm: Number(realtime.tpm || 0) };
            })
            .put('/currency', async ({ body, user }: ElysiaCtx) => {
                const userRow = user as UserRecord;
                const { currency } = body;
                if (!['USD', 'RMB'].includes(currency)) throw new Error('Invalid currency');
                await db.update(users).set({ currency }).where(eq(users.id, userRow.id));
                return { success: true, currency };
            })
    )

    .get('/discord', ({ set }) => {
        const url = `${apiUrls.discord.authorize}?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
        set.redirect = url;
    })
    .get('/discord/callback', async ({ query, set }) => {
        const { code } = query;
        if (!code) throw new Error("No code provided");
        const tokenRes = await fetch(apiUrls.discord.token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: code, redirect_uri: DISCORD_REDIRECT_URI })
        });
        const tokenData = await tokenRes.json() as Record<string, any>;
        if (tokenData.error) throw new Error(tokenData.error_description || "Discord auth failed");
        const userRes = await fetch(apiUrls.discord.user, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
        const discordUser = await userRes.json() as Record<string, any>;
        const [existingOAuth] = await db
            .select({ userId: oauthAccounts.userId })
            .from(oauthAccounts)
            .where(and(eq(oauthAccounts.provider, 'discord'), eq(oauthAccounts.providerUserId, discordUser.id)))
            .limit(1);
        let user;
        if (existingOAuth) {
            const [userRow] = await db
                .select({ id: users.id, username: users.username, role: users.role })
                .from(users)
                .where(eq(users.id, existingOAuth.userId))
                .limit(1);
            user = userRow;
        } else {
            const username = `discord:${discordUser.username}#${discordUser.discriminator}`;
            const [newUser] = await db
                .insert(users)
                .values({ username, passwordHash: 'oauth-no-password', role: 1, quota: 500000, status: 1 })
                .returning({ id: users.id, username: users.username, role: users.role });
            user = newUser;
            await db.insert(oauthAccounts).values({
                userId: user.id,
                provider: 'discord',
                providerUserId: discordUser.id,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: drizzleSql`NOW() + (${Number(tokenData.expires_in) || 604800} * INTERVAL '1 second')`,
            });
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await db.insert(tokens).values({ userId: user.id, name: 'Default API Key', key: newKey, status: 1, remainQuota: -1 });
         }
        const sessionToken = await authService.generateSessionToken(user.id);
        const targetUrl = config.webUrl || 'http://localhost:5173';
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}&role=${user.role}`;
    })
    .get('/telegram', async ({ query, set }) => {
        const { id, username, auth_date, hash } = query as Record<string, string>;
        if (!id || !auth_date || !hash) throw new Error('Invalid Telegram data');
        const dataCheckString = Object.keys(query).filter(k => k !== 'hash').sort().map(k => `${k}=${query[k]}`).join('\n');
        const secretKey = new Bun.CryptoHasher("sha256").update(TELEGRAM_BOT_TOKEN).digest();
        if (hash !== new Bun.CryptoHasher("sha256", secretKey).update(dataCheckString).digest("hex")) throw new Error('Invalid hash');
        if (Date.now() / 1000 - parseInt(auth_date) > 86400) throw new Error('Data expired');
        const [existingOAuth] = await db
            .select({ userId: oauthAccounts.userId })
            .from(oauthAccounts)
            .where(and(eq(oauthAccounts.provider, 'telegram'), eq(oauthAccounts.providerUserId, String(id))))
            .limit(1);
        let user;
        if (existingOAuth) {
            const [userRow] = await db
                .select({ id: users.id, username: users.username, role: users.role })
                .from(users)
                .where(eq(users.id, existingOAuth.userId))
                .limit(1);
            user = userRow;
        } else {
            const displayUsername = `telegram:${username || `user_${id}`}`;
            const [newUser] = await db
                .insert(users)
                .values({ username: displayUsername, passwordHash: 'oauth-no-password', role: 1, quota: 500000, status: 1 })
                .returning({ id: users.id, username: users.username, role: users.role });
            user = newUser;
            await db.insert(oauthAccounts).values({
                userId: user.id,
                provider: 'telegram',
                providerUserId: String(id),
            });
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await db.insert(tokens).values({ userId: user.id, name: 'Default Token', key: newKey, status: 1, remainQuota: -1 });
        }
        const sessionToken = await authService.generateSessionToken(user.id);
        const targetUrl = config.webUrl || 'http://localhost:5173';
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}&role=${user.role}`;
    });
