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
     * Generate a simple JWT or opaque token for the frontend sessions.
     * For simplicity in this gateway, we'll just return the user info and potentially 
     * a token that the frontend can use or just set a cookie.
     */
    async generateSessionToken(userId: number) {
        // Use Bun native UUID v7: time-ordered, cryptographically random, no external deps
        return `sess_${Bun.randomUUIDv7('hex')}`;
    }
};
