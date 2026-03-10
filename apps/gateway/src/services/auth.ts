import { sql } from '@elygate/db';

const INITIAL_QUOTA = Number(process.env.INITIAL_QUOTA) || 500000;

export const authService = {
    /**
     * Get or create a user by GitHub ID (mapped to username for simplicity or a separate field)
     */
    async getOrCreateGithubUser(githubId: string, username: string) {
        // In a real app, we'd have a github_id column. 
        // For this demo, we'll use 'github:' prefix in username.
        const internalUsername = `github:${githubId}`;

        let [user] = await sql`
            SELECT id, username, role, quota, status 
            FROM users 
            WHERE username = ${internalUsername}
            LIMIT 1
        `;

        if (!user) {
            console.log(`[Auth] Creating new GitHub user: ${username} (${githubId})`);
            [user] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${internalUsername}, 'oauth-no-password', 1, ${INITIAL_QUOTA}, 1)
                RETURNING id, username, role, quota, status
            `;

            // Generate default API key using Bun native UUID v7 (time-ordered, faster)
            const defaultTokenKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota)
                VALUES (${user.id}, 'Default Token', ${defaultTokenKey}, 1, -1)
            `;
        }

        return user;
    },

    /**
     * Generate a session token for OAuth logins.
     * Returns the user's first active API key (or creates one).
     * This is what the frontend stores as the bearer token for all API calls.
     */
    async generateSessionToken(userId: number) {
        // Look up existing active token
        let [token] = await sql`
            SELECT key FROM tokens
            WHERE user_id = ${userId} AND status = 1
            ORDER BY id ASC LIMIT 1
        `;

        // No token yet: create a default one
        if (!token) {
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            [token] = await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota)
                VALUES (${userId}, 'Default Token', ${newKey}, 1, -1)
                RETURNING key
            `;
        }

        return token.key;
    }
};
