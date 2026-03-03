import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authService } from '../services/auth';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/auth/github/callback';

export const authRouter = new Elysia({ prefix: '/auth' })
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
            if (user.role < 10) {
                set.status = 403;
                return { success: false, message: 'Admin privileges required' };
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

        return await sql`
            SELECT id, model_name as "modelName", prompt_tokens as "promptTokens", completion_tokens as "completionTokens", quota_cost as "quotaCost", created_at as "createdAt"
            FROM logs 
            WHERE user_id = ${userRow.id}
            ORDER BY created_at DESC 
            LIMIT 50
        `;
    });
