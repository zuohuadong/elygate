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

            // Optionally create a default token for the user immediately
            const defaultTokenKey = `sk-${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex')}`;
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
        // This would typically involve a library like 'jose' or 'jsonwebtoken'
        // For now, we'll just return a mock token string.
        return `sess_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
    }
};
