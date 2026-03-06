import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authService } from '../services/auth';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/auth/github/callback';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/api/auth/discord/callback';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export const authRouter = new Elysia()
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
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}`;
    })
    // User registration
    .post('/register', async ({ body, set }: any) => {
        try {
            const { username, password } = body;
            if (!username || !password) {
                set.status = 400;
                return { success: false, message: 'Username and password are required' };
            }

            // Check if user exists
            const [existing] = await sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`;
            if (existing) {
                set.status = 409;
                return { success: false, message: 'Username already exists' };
            }

            // Hash password
            const passwordHash = await Bun.password.hash(password);

            // Create user
            const [user] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${username}, ${passwordHash}, 1, 500000, 1)
                RETURNING id, username, role
            `;

            // Create default token
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota)
                VALUES (${user.id}, 'Default Token', ${newKey}, 1, -1)
            `;

            return {
                success: true,
                message: 'Registration successful',
                data: {
                    username: user.username,
                    role: user.role
                }
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
    // Admin username/password login - returns the user's API token for management panel use
    .post('/login', async ({ body, set }: any) => {
        try {
            const { username, password } = body;
            if (!username || !password) {
                set.status = 400;
                return { success: false, message: 'Username and password are required' };
            }

            const [user] = await sql`
                SELECT id, username, password_hash, role, status
                FROM users
                WHERE username = ${username}
                LIMIT 1
            `;

            if (!user) {
                set.status = 401;
                return { success: false, message: 'Invalid username or password' };
            }
            if (user.status !== 1) {
                set.status = 403;
                return { success: false, message: 'Account is disabled' };
            }
            if (user.role < 1) {
                set.status = 403;
                return { success: false, message: 'Account has no access' };
            }
            // Verify password using Bun's native bcrypt/argon2
            let isValid = false;
            try {
                isValid = await Bun.password.verify(password, user.password_hash);
            } catch (_) {
                isValid = false;
            }

            if (!isValid) {
                set.status = 401;
                return { success: false, message: 'Invalid username or password' };
            }

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

            return {
                success: true,
                token: token.key,
                username: user.username,
                role: user.role
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
    // Validate a token and return user info (for /me checks in the frontend)
    .get('/me', async ({ request, set }: any) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const [row] = await sql`
            SELECT u.id, u.username, u.role, u.quota, u.used_quota as "usedQuota", u."group", t.key
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
    .get('/logs', async ({ request, set }: any) => {
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

        const page = Number(request.query?.page) || 1;
        const limit = Number(request.query?.limit) || 50;
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
    .get('/tokens', async ({ request, set }: any) => {
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
            SELECT id, name, key, status, remain_quota as "remainQuota", used_quota as "usedQuota", created_at as "createdAt", models
            FROM tokens 
            WHERE user_id = ${userRow.id}
            ORDER BY id DESC
        `;

        return [...data];
    })
    .post('/tokens', async ({ body, request, set }: any) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const [userRow] = await sql`
            SELECT u.id FROM tokens t JOIN users u ON t.user_id = u.id
            WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;
        if (!userRow) {
            set.status = 401;
            throw new Error('Unauthorized');
        }

        const b = body as any;
        const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
        const [result] = await sql`
            INSERT INTO tokens (user_id, name, key, status, remain_quota, models)
            VALUES (${userRow.id}, ${b.name}, ${newKey}, 1, ${b.remainQuota || -1}, ${JSON.stringify(b.models || [])})
            RETURNING *
        `;
        return result;
    })
    .put('/tokens/:id', async ({ params: { id }, body, request, set }: any) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const [userRow] = await sql`
            SELECT u.id FROM tokens t JOIN users u ON t.user_id = u.id
            WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;
        if (!userRow) {
            set.status = 401;
            throw new Error('Unauthorized');
        }

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
    .delete('/tokens/:id', async ({ params: { id }, request, set }: any) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const key = authHeader.substring(7);
        const [userRow] = await sql`
            SELECT u.id FROM tokens t JOIN users u ON t.user_id = u.id
            WHERE t.key = ${key} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;
        if (!userRow) {
            set.status = 401;
            throw new Error('Unauthorized');
        }

        const [result] = await sql`DELETE FROM tokens WHERE id = ${Number(id)} AND user_id = ${userRow.id} RETURNING *`;
        if (!result) {
            set.status = 403;
            throw new Error('Forbidden or token not found');
        }
        return { success: true, deleted: result };
    })
    // Get personal stats (for Dashboard chart)
    .get('/stats', async ({ request, set }: any) => {
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
    .get('/realtime', async ({ request, set }: any) => {
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
                SELECT id, username FROM users WHERE id = ${existingOAuth.user_id} LIMIT 1
            `;
            user = userRow;
        } else {
            const username = `discord:${discordUser.username}#${discordUser.discriminator}`;
            const [newUser] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${username}, 'oauth-no-password', 1, 500000, 1)
                RETURNING id, username
            `;
            user = newUser;

            await sql`
                INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at)
                VALUES (${user.id}, 'discord', ${discordUser.id}, ${tokenData.access_token}, ${tokenData.refresh_token}, NOW() + INTERVAL '${tokenData.expires_in} seconds')
            `;

            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota)
                VALUES (${user.id}, 'Default Token', ${newKey}, 1, -1)
            `;
        }

        const sessionToken = await authService.generateSessionToken(user.id);
        const targetUrl = process.env.WEB_URL || 'http://localhost:5173';
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}`;
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

        const encoder = new TextEncoder();
        const secretKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(TELEGRAM_BOT_TOKEN),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(dataCheckString));
        const expectedHash = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

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
                SELECT id, username FROM users WHERE id = ${existingOAuth.user_id} LIMIT 1
            `;
            user = userRow;
        } else {
            const telegramUsername = username || `telegram_${id}`;
            const fullName = [first_name, last_name].filter(Boolean).join(' ');
            const displayUsername = `telegram:${telegramUsername}`;

            const [newUser] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${displayUsername}, 'oauth-no-password', 1, 500000, 1)
                RETURNING id, username
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
        set.redirect = `${targetUrl}/auth/callback?token=${sessionToken}&username=${user.username}`;
    });
