import { config } from '../config';
import { log } from '../services/logger';
import { db, sql } from '@elygate/db';
import { users, tokens, sessions } from '@elygate/db/schema';
import { eq, asc } from 'drizzle-orm';

const INITIAL_QUOTA = Number(String(config.initialQuota)) || 500000;

export const authService = {
    /**
     * Get or create a user by GitHub ID (mapped to username for simplicity or a separate field)
     */
    async getOrCreateGithubUser(githubId: string, username: string) {
        // In a real app, we'd have a github_id column. 
        // For this demo, we'll use 'github:' prefix in username.
        const internalUsername = `github:${githubId}`;

        let [user] = await db
            .select({
                id: users.id,
                username: users.username,
                role: users.role,
                quota: users.quota,
                status: users.status,
            })
            .from(users)
            .where(eq(users.username, internalUsername))
            .limit(1);

        if (!user) {
            log.info(`[Auth] Creating new GitHub user: ${username} (${githubId})`);
            [user] = await db
                .insert(users)
                .values({
                    username: internalUsername,
                    passwordHash: 'oauth-no-password',
                    role: 1,
                    quota: INITIAL_QUOTA,
                    status: 1,
                })
                .returning({
                    id: users.id,
                    username: users.username,
                    role: users.role,
                    quota: users.quota,
                    status: users.status,
                });

            // Generate default API key using Bun native UUID v7 (time-ordered, faster)
            const defaultTokenKey = `sk-${Bun.randomUUIDv7('hex')}`;
            await db.insert(tokens).values({
                userId: user.id,
                name: 'Default API Key',
                key: defaultTokenKey,
                status: 1,
                remainQuota: -1,
            });
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
        let [token] = await db
            .select({ key: tokens.key })
            .from(tokens)
            .where(eq(tokens.userId, userId))
            .orderBy(asc(tokens.id))
            .limit(1);

        // No token yet: create a default one
        if (!token) {
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            [token] = await db
                .insert(tokens)
                .values({
                    userId,
                    name: 'Default API Key',
                    key: newKey,
                    status: 1,
                    remainQuota: -1,
                })
                .returning({ key: tokens.key });
        }

        return token.key;
    },

    async ensureDefaultApiKey(userId: number) {
        let [token] = await db
            .select({ key: tokens.key })
            .from(tokens)
            .where(eq(tokens.userId, userId))
            .orderBy(asc(tokens.id))
            .limit(1);

        if (!token) {
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            [token] = await db
                .insert(tokens)
                .values({
                    userId,
                    name: 'Default API Key',
                    key: newKey,
                    status: 1,
                    remainQuota: -1,
                })
                .returning({ key: tokens.key });
        }

        return token.key;
    },

    async createWebSession(userId: number, clientIP: string, userAgent: string) {
        const sessionToken = `sess_${Bun.randomUUIDv7('hex')}${Bun.randomUUIDv7('hex')}`;
        const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);
        await db.insert(sessions).values({
            id: Bun.randomUUIDv7('hex'),
            userId,
            token: sessionToken,
            expiresAt,
            ipAddress: clientIP,
            userAgent,
        });
        return { sessionToken, expiresAt };
    }
};
