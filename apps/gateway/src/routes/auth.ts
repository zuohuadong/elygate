import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authService } from '../services/auth';
import { authPlugin } from '../middleware/auth';
import type { UserRecord } from '../types';
import { getLangFromHeader } from '../utils/i18n';
import { optionCache } from '../services/optionCache';
import { memoryCache } from '../services/cache';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/auth/github/callback';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/api/auth/discord/callback';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

import { jwt } from '@elysiajs/jwt';

export const authRouter = new Elysia()
    .use(jwt({
        name: 'jwt',
        secret: process.env.JWT_SECRET || 'super-secret-elygate-jwt-key',
        exp: '7d'
    }))
    .get('/github', ({ set }) => {
        const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=read:user`;
        set.redirect = url;
    })
    .get('/github/callback', async ({ query, set }) => {
        const { code } = query;
        if (!code) throw new Error("No code provided");

        // 1. Exchange code for access token
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
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

        const tokenData = await tokenRes.json() as any;
        if (tokenData.error) throw new Error(tokenData.error_description || "GitHub auth failed");

        const accessToken = tokenData.access_token;

        // 2. Fetch user info
        const userRes = await fetch('https://github.com/user', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'User-Agent': 'elygate-server'
            }
        });

        const githubUser = await userRes.json() as any;

        // 3. Get or Create user in our DB
        const user = await authService.getOrCreateGithubUser(githubUser.id.toString(), githubUser.login);

        // 4. Generate local session (For simplicity, we'll just redirect back to web with a temporary login token)
        // In a production app, use HTTP-only cookies.
        const sessionToken = await authService.generateSessionToken(user.id);

        const targetUrl = process.env.WEB_URL || 'http://localhost:5173';
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}&role=${user.role}`;
    })
    // User registration
    .post('/register', async ({ body, set, request }: any) => {
        const lang = getLangFromHeader(request.headers.get('accept-language'));
        try {
            const { username, password, inviteCode } = body;
            if (!username || !password) {
                set.status = 400;
                return { success: false, message: lang === 'zh' ? '用户名和密码不能为空' : 'Username and password are required' };
            }

            const registerMode = optionCache.get('RegisterMode', 'open');
            const defaultQuota = parseInt(optionCache.get('SignRegisterQuota', '500000')) || 500000;

            if (registerMode === 'closed') {
                set.status = 403;
                return { success: false, message: lang === 'zh' ? '注册功能已关闭' : 'Registration is currently disabled' };
            }

            let giftQuota = 0;
            let inviteCodeRecord: any = null;

            if (inviteCode) {
                const [codeRecord] = await sql`
                    SELECT * FROM invite_codes WHERE code = ${inviteCode} LIMIT 1
                `;

                if (!codeRecord) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码无效' : 'Invalid invite code' };
                }

                if (codeRecord.status !== 1) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码已禁用' : 'Invite code is disabled' };
                }

                if (codeRecord.expires_at && new Date(codeRecord.expires_at) < new Date()) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码已过期' : 'Invite code has expired' };
                }

                if (codeRecord.used_count >= codeRecord.max_uses) {
                    set.status = 400;
                    return { success: false, message: lang === 'zh' ? '邀请码使用次数已达上限' : 'Invite code usage limit reached' };
                }

                giftQuota = codeRecord.gift_quota || 0;
                inviteCodeRecord = codeRecord;
            } else if (registerMode === 'invite') {
                set.status = 400;
                return { success: false, message: lang === 'zh' ? '注册需要邀请码' : 'Invite code is required for registration' };
            }

            // Check if user exists
            const [existing] = await sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`;
            if (existing) {
                set.status = 409;
                return { success: false, message: lang === 'zh' ? '用户名已存在' : 'Username already exists' };
            }

            // Hash password
            const passwordHash = await Bun.password.hash(password);

            const totalQuota = defaultQuota + giftQuota;

            // Create user
            const [user] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${username}, ${passwordHash}, 1, ${totalQuota}, 1)
                RETURNING id, username, role
            `;

            if (inviteCodeRecord) {
                await sql`
                    UPDATE invite_codes 
                    SET used_count = used_count + 1, updated_at = NOW()
                    WHERE id = ${inviteCodeRecord.id}
                `;
            }

            // Create default token
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota)
                VALUES (${user.id}, 'Default Token', ${newKey}, 1, -1)
            `;

            return {
                success: true,
                message: lang === 'zh' ? '注册成功' : 'Registration successful',
                data: {
                    username: user.username,
                    role: user.role,
                    giftQuota: giftQuota > 0 ? giftQuota : undefined
                }
            };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e?.message || (lang === 'zh' ? '服务器内部错误' : 'Internal server error') };
        }
    }, {
        body: t.Object({
            username: t.String(),
            password: t.String(),
            inviteCode: t.Optional(t.String())
        })
    })
    // Admin username/password login - returns the user's API token for management panel use
    .post('/login', async ({ body, set, request, jwt, cookie: { auth_session } }: any) => {
        const lang = getLangFromHeader(request.headers);
        const clientIP = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

        try {
            const { username, password } = body;
            if (!username || !password) {
                set.status = 400;
                return { success: false, message: lang === 'zh' ? '用户名和密码不能为空' : 'Username and password are required' };
            }

            const [user] = await sql`
                SELECT id, username, password_hash, role, status, locked_until, currency
                FROM users
                WHERE username = ${username}
                LIMIT 1
            `;
            if (!user) {
                await sql`INSERT INTO login_attempts (username, ip_address, success) VALUES (${username}, ${clientIP}, false)`;
                set.status = 401;
                return { success: false, message: lang === 'zh' ? '用户名或密码错误' : 'Invalid username or password' };
            }

            // Check if account is locked
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                const remainingMinutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
                set.status = 403;
                return {
                    success: false,
                    message: lang === 'zh'
                        ? `账户已被锁定，请 ${remainingMinutes} 分钟后重试`
                        : `Account is locked, please try again in ${remainingMinutes} minutes`
                };
            }

            if (user.status !== 1) {
                set.status = 403;
                return { success: false, message: lang === 'zh' ? '账户已被禁用' : 'Account is disabled' };
            }
            if (user.role < 1) {
                set.status = 403;
                return { success: false, message: lang === 'zh' ? '账户无访问权限' : 'Account has no access' };
            }

            // Verify password using Bun's native bcrypt/argon2
            let isValid = false;
            try {
                isValid = await Bun.password.verify(password, user.password_hash);
            } catch (_) {
                isValid = false;
            }

            if (!isValid) {
                // Record failed attempt
                await sql`INSERT INTO login_attempts (username, ip_address, success) VALUES (${username}, ${clientIP}, false)`;

                // Check failed attempts in last 15 minutes
                const [failedAttempts] = await sql`
                    SELECT COUNT(*) as count 
                    FROM login_attempts 
                    WHERE username = ${username} 
                    AND success = false 
                    AND created_at > NOW() - INTERVAL '15 minutes'
                `;

                // Lock account after 5 failed attempts
                if (Number(failedAttempts.count) >= 5) {
                    await sql`UPDATE users SET locked_until = NOW() + INTERVAL '15 minutes' WHERE id = ${user.id}`;
                    set.status = 403;
                    return {
                        success: false,
                        message: lang === 'zh'
                            ? '登录失败次数过多，账户已被锁定 15 分钟'
                            : 'Too many failed attempts, account locked for 15 minutes'
                    };
                }

                set.status = 401;
                return { success: false, message: lang === 'zh' ? '用户名或密码错误' : 'Invalid username or password' };
            }

            // Successful login - clear failed attempts and unlock account
            await sql`DELETE FROM login_attempts WHERE username = ${username}`;
            await sql`UPDATE users SET locked_until = NULL WHERE id = ${user.id}`;
            await sql`INSERT INTO login_attempts (username, ip_address, success) VALUES (${username}, ${clientIP}, true)`;

            // Get the user's first active token (or create one)
            let [token] = await sql`
                SELECT key FROM tokens 
                WHERE user_id = ${user.id} AND status = 1
                ORDER BY id ASC LIMIT 1
            `;

            if (!token) {
                const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
                [token] = await sql`
                    INSERT INTO tokens (user_id, name, key, status, remain_quota)
                    VALUES (${user.id}, 'Admin Token', ${newKey}, 1, -1)
                    RETURNING key
                `;
            }

            // Set the HTTP-Only cookie for Web UI sessions (JWT-like payload as token)
            // Cryptographically strong random session token
            const sessionToken = `sess_${Bun.randomUUIDv7('hex')}${Bun.randomUUIDv7('hex')}`;
            const expiresAt = new Date(Date.now() + 7 * 86400 * 1000); // 7 days
            const sessionId = Bun.randomUUIDv7('hex');
            const userAgent = request.headers.get('user-agent') || 'unknown';

            await sql`
                INSERT INTO session (id, user_id, token, expires_at, ip_address, user_agent)
                VALUES (${sessionId}, ${user.id}, ${sessionToken}, ${expiresAt}, ${clientIP}, ${userAgent})
            `;

            auth_session.set({
                value: sessionToken,
                httpOnly: true,
                secure: false, // Allow HTTP for development and non-HTTPS deployments
                sameSite: 'lax',
                maxAge: 7 * 86400,
                path: '/'
            });

            return {
                success: true,
                token: token.key,
                username: user.username,
                role: user.role,
                currency: user.currency || 'USD'
            };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e?.message || 'Internal server error' };
        }
    }, {
        body: t.Object({
            username: t.String(),
            password: t.String()
        })
    })
    // Logout route to clear JWT cookie
    .post('/logout', async ({ cookie: { auth_session } }: any) => {
        if (auth_session.value) {
            await sql`DELETE FROM session WHERE token = ${auth_session.value}`;
        }
        auth_session.remove();
        return { success: true, message: 'Logged out successfully' };
    })
    // Validate a token or session cookie and return user info (for /me checks in the frontend)
    .get('/me', async ({ request, set, cookie: { auth_session } }: any) => {
        // First try Cookie Session authentication
        if (auth_session?.value) {
            const [sessionRow] = await sql`
                SELECT s.user_id, s.expires_at, u.id, u.username, u.role, u.quota, u.used_quota as "usedQuota", u."group", u.currency, u.status
                FROM session s
                JOIN users u ON s.user_id = u.id
                WHERE s.token = ${auth_session.value}
                LIMIT 1
            `;

            if (sessionRow) {
                if (new Date(sessionRow.expires_at) < new Date()) {
                    await sql`DELETE FROM session WHERE token = ${auth_session.value}`;
                    set.status = 401;
                    throw new Error('Session has expired');
                }

                if (sessionRow.status !== 1) {
                    set.status = 401;
                    throw new Error('User account is disabled');
                }

                return {
                    id: sessionRow.id,
                    username: sessionRow.username,
                    role: sessionRow.role,
                    quota: sessionRow.quota,
                    usedQuota: sessionRow.usedQuota,
                    group: sessionRow.group,
                    currency: sessionRow.currency || 'USD'
                };
            }
        }

        // Fallback to Bearer Token authentication
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const [row] = await sql`
            SELECT u.id, u.username, u.role, u.quota, u.used_quota as "usedQuota", u."group", u.currency, t.key
            FROM tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;
        if (!row) {
            set.status = 401;
            throw new Error('Invalid or expired token');
        }
        return row;
    })
    // Get personal logs
    .get('/logs', async ({ request, set, query }: any) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const [userRow] = await sql`
            SELECT u.id
            FROM tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;
        if (!userRow) {
            set.status = 401;
            throw new Error('Unauthorized');
        }

        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const [countRow] = await sql`
            SELECT COUNT(*) as total
            FROM logs
            WHERE user_id = ${userRow.id}
        `;

        const data = await sql`
            SELECT id, model_name as "modelName", prompt_tokens as "promptTokens", completion_tokens as "completionTokens", quota_cost as "quotaCost", created_at as "createdAt", is_stream as "isStream"
            FROM logs 
            WHERE user_id = ${userRow.id}
            ORDER BY created_at DESC 
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data,
            total: countRow.total,
            page,
            limit
        };
    })
    // Get personal tokens
    .get('/tokens', async ({ user, set }: any) => {
        const userRow = user as UserRecord;

        const data = await sql`
            SELECT id, name, key, status, remain_quota as "remainQuota", used_quota as "usedQuota", created_at as "createdAt", models
            FROM tokens 
            WHERE user_id = ${userRow.id}
            ORDER BY id DESC
        `;

        return [...data];
    })
    .post('/tokens', async ({ body, user, set }: any) => {
        const userRow = user as UserRecord;

        const b = body as any;
        const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
        const [result] = await sql`
            INSERT INTO tokens (user_id, name, key, status, remain_quota, models)
            VALUES (${userRow.id}, ${b.name}, ${newKey}, 1, ${b.remainQuota || -1}, ${JSON.stringify(b.models || [])})
            RETURNING *
        `;
        return result;
    })
    .put('/tokens/:id', async ({ params: { id }, body, user, set }: any) => {
        const userRow = user as UserRecord;

        // Verify ownership
        const [existing] = await sql`SELECT id FROM tokens WHERE id = ${Number(id)} AND user_id = ${userRow.id}`;
        if (!existing) {
            set.status = 403;
            throw new Error('Forbidden: You do not own this token');
        }

        const [result] = await sql`
            UPDATE tokens 
            SET name = COALESCE(${body.name}, name),
                status = COALESCE(${body.status}, status),
                remain_quota = COALESCE(${body.remainQuota}, remain_quota),
                models = COALESCE(${body.models ? JSON.stringify(body.models) : null}, models)
            WHERE id = ${Number(id)} AND user_id = ${userRow.id}
            RETURNING *
        `;
        return result;
    })
    .delete('/tokens/:id', async ({ params: { id }, user, set }: any) => {
        const userRow = user as UserRecord;

        const [result] = await sql`DELETE FROM tokens WHERE id = ${Number(id)} AND user_id = ${userRow.id} RETURNING *`;
        if (!result) {
            set.status = 403;
            throw new Error('Forbidden or token not found');
        }
        return { success: true, deleted: result };
    })
    // Get personal stats (for Dashboard chart)
    .get('/stats', async ({ user, set }: any) => {
        const userRow = user as UserRecord;

        const dailyStats = await sql`
            SELECT 
                DATE(created_at) as date,
                SUM(prompt_tokens + completion_tokens) as total_tokens,
                SUM(quota_cost) as total_cost,
                COUNT(*) as request_count
            FROM logs
            WHERE user_id = ${userRow.id}
            AND created_at >= NOW() - INTERVAL '14 days'
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `;

        return dailyStats;
    })

    // Get personal real-time metrics (RPM/TPM)
    .get('/realtime', async ({ user, set }: any) => {
        const userRow = user as UserRecord;

        const [realtime] = await sql`
            SELECT 
                COUNT(*) as rpm,
                COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tpm
            FROM logs
            WHERE user_id = ${userRow.id}
            AND created_at >= NOW() - INTERVAL '1 minute'
        `;

        return {
            rpm: Number(realtime.rpm || 0),
            tpm: Number(realtime.tpm || 0)
        };
    })

    .get('/discord', ({ set }) => {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
        set.redirect = url;
    })

    .get('/discord/callback', async ({ query, set }) => {
        const { code } = query;
        if (!code) throw new Error("No code provided");

        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI
            })
        });

        const tokenData = await tokenRes.json() as any;
        if (tokenData.error) throw new Error(tokenData.error_description || "Discord auth failed");

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`
            }
        });

        const discordUser = await userRes.json() as any;

        const [existingOAuth] = await sql`
            SELECT user_id FROM oauth_accounts 
            WHERE provider = 'discord' AND provider_user_id = ${discordUser.id}
            LIMIT 1
        `;

        let user;
        if (existingOAuth) {
            const [userRow] = await sql`
                SELECT id, username, role FROM users WHERE id = ${existingOAuth.user_id} LIMIT 1
            `;
            user = userRow;
        } else {
            const username = `discord:${discordUser.username}#${discordUser.discriminator}`;
            const [newUser] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${username}, 'oauth-no-password', 1, 500000, 1)
                RETURNING id, username, role
            `;
            user = newUser;

            await sql`
                INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at)
                VALUES (${user.id}, 'discord', ${discordUser.id}, ${tokenData.access_token}, ${tokenData.refresh_token}, NOW() + (${Number(tokenData.expires_in) || 604800} * INTERVAL '1 second'))
            `;

            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota)
                VALUES (${user.id}, 'Default Token', ${newKey}, 1, -1)
            `;
        }

        const sessionToken = await authService.generateSessionToken(user.id);
        const targetUrl = process.env.WEB_URL || 'http://localhost:5173';
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}&role=${user.role}`;
    })

    .get('/telegram', async ({ query, set }) => {
        const { id, first_name, last_name, username, photo_url, auth_date, hash } = query as any;

        if (!id || !auth_date || !hash) {
            set.status = 400;
            throw new Error('Invalid Telegram login data');
        }

        const dataCheckString = Object.keys(query)
            .filter(key => key !== 'hash')
            .sort()
            .map(key => `${key}=${query[key]}`)
            .join('\n');

        // Per Telegram spec: secret_key = SHA256(bot_token), then HMAC-SHA256(data_check_string, secret_key)
        const secretKey = new Bun.CryptoHasher("sha256").update(TELEGRAM_BOT_TOKEN).digest();
        const expectedHash = new Bun.CryptoHasher("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        if (hash !== expectedHash) {
            set.status = 401;
            throw new Error('Invalid Telegram login hash');
        }

        const authTimestamp = parseInt(auth_date);
        if (Date.now() / 1000 - authTimestamp > 86400) {
            set.status = 401;
            throw new Error('Telegram login data is too old');
        }

        const [existingOAuth] = await sql`
            SELECT user_id FROM oauth_accounts 
            WHERE provider = 'telegram' AND provider_user_id = ${String(id)}
            LIMIT 1
        `;

        let user;
        if (existingOAuth) {
            const [userRow] = await sql`
                SELECT id, username, role FROM users WHERE id = ${existingOAuth.user_id} LIMIT 1
            `;
            user = userRow;
        } else {
            const telegramUsername = username || `telegram_${id}`;
            const fullName = [first_name, last_name].filter(Boolean).join(' ');
            const displayUsername = `telegram:${telegramUsername}`;

            const [newUser] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${displayUsername}, 'oauth-no-password', 1, 500000, 1)
                RETURNING id, username, role
            `;
            user = newUser;

            await sql`
                INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
                VALUES (${user.id}, 'telegram', ${String(id)})
            `;

            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota)
                VALUES (${user.id}, 'Default Token', ${newKey}, 1, -1)
            `;
        }

        const sessionToken = await authService.generateSessionToken(user.id);
        const targetUrl = process.env.WEB_URL || 'http://localhost:5173';
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}&role=${user.role}`;
    })

    // Update user currency preference
    .put('/currency', async ({ body, request, set }: any) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const { currency } = body;

        if (!['USD', 'RMB'].includes(currency)) {
            set.status = 400;
            return { success: false, message: 'Invalid currency' };
        }

        const [userRow] = await sql`
            SELECT u.id FROM tokens t JOIN users u ON t.user_id = u.id
            WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;

        if (!userRow) {
            set.status = 401;
            throw new Error('Unauthorized');
        }

        await sql`
            UPDATE users SET currency = ${currency} WHERE id = ${userRow.id}
        `;

        return { success: true, currency };
    }, {
        body: t.Object({
            currency: t.String()
        })
    })

    // Get public packages (C-end)
    .get('/packages', async ({ request, set }: any) => {
        const authHeader = request.headers.get('authorization');
        let userGroup = 'default';

        if (authHeader?.startsWith('Bearer ')) {
            const key = authHeader.substring(7);
            const [userRow] = await sql`
                SELECT u."group"
                FROM tokens t
                JOIN users u ON t.user_id = u.id
                WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
                LIMIT 1
            `;
            if (userRow && userRow.group) {
                userGroup = userRow.group;
            }
        }

        const data = await sql`
            SELECT id, name, description, price, duration_days, models, allowed_groups
            FROM packages
            WHERE is_public = true
            ORDER BY price ASC
        `;

        const filtered = data.filter((pkg: any) => {
            // Check Package -> Group direction
            const allowedGroups = Array.isArray(pkg.allowed_groups) ? pkg.allowed_groups : (typeof pkg.allowed_groups === 'string' ? JSON.parse(pkg.allowed_groups || '[]') : []);
            if (allowedGroups.length > 0 && !allowedGroups.includes(userGroup)) {
                return false;
            }

            // Check Group -> Package direction
            const policy = memoryCache.userGroups.get(userGroup);
            if (policy && policy.allowedPackages && policy.allowedPackages.length > 0) {
                if (!policy.allowedPackages.includes(pkg.id)) {
                    return false;
                }
            }
            return true;
        });

        return filtered;
    })

    // Get personal subscriptions (C-end)
    .get('/subscriptions', async ({ request, set }: any) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const [userRow] = await sql`
            SELECT u.id
            FROM tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;
        if (!userRow) {
            set.status = 401;
            throw new Error('Unauthorized');
        }

        const data = await sql`
            SELECT s.id, s.package_id, p.name as package_name, p.models, s.start_time, s.end_time, s.status
            FROM user_subscriptions s
            JOIN packages p ON s.package_id = p.id
            WHERE s.user_id = ${userRow.id} AND s.status = 1
            ORDER BY s.end_time DESC
        `;
        return data;
    });
