import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { getErrorMessage } from '../src/utils/error';
import { sql } from '@elygate/db';

describe('OAuth System Tests', () => {
    let testUserId: number;
    let testOAuthId: number;

    beforeAll(async () => {
        const [user] = await sql`
            INSERT INTO users (username, password_hash, role, quota, status)
            VALUES ('test_oauth_user', 'test_hash', 1, 100000, 1)
            RETURNING id
        `;
        testUserId = user.id;
    });

    afterAll(async () => {
        await sql`DELETE FROM oauth_accounts WHERE user_id = ${testUserId}`;
        await sql`DELETE FROM users WHERE id = ${testUserId}`;
    });

    test('should create Discord OAuth account', async () => {
        const [oauth] = await sql`
            INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at)
            VALUES (${testUserId}, 'discord', 'discord_test_123', 'discord_access_token', 'discord_refresh_token', NOW() + INTERVAL '1 hour')
            RETURNING *
        `;
        
        expect(oauth).toBeDefined();
        expect(oauth.user_id).toBe(testUserId);
        expect(oauth.provider).toBe('discord');
        expect(oauth.provider_user_id).toBe('discord_test_123');
        
        testOAuthId = oauth.id;
    });

    test('should create Telegram OAuth account', async () => {
        const [oauth] = await sql`
            INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
            VALUES (${testUserId}, 'telegram', 'telegram_test_456')
            RETURNING *
        `;
        
        expect(oauth).toBeDefined();
        expect(oauth.provider).toBe('telegram');
        expect(oauth.provider_user_id).toBe('telegram_test_456');
    });

    test('should query OAuth accounts by user', async () => {
        const accounts = await sql`
            SELECT * FROM oauth_accounts
            WHERE user_id = ${testUserId}
            ORDER BY provider
        `;
        
        expect(accounts.length).toBe(2);
        expect(accounts[0].provider).toBe('discord');
        expect(accounts[1].provider).toBe('telegram');
    });

    test('should query OAuth account by provider', async () => {
        const [account] = await sql`
            SELECT * FROM oauth_accounts
            WHERE provider = 'discord' AND provider_user_id = 'discord_test_123'
        `;
        
        expect(account).toBeDefined();
        expect(account.user_id).toBe(testUserId);
    });

    test('should update OAuth tokens', async () => {
        const [updated] = await sql`
            UPDATE oauth_accounts
            SET access_token = 'new_access_token', 
                refresh_token = 'new_refresh_token',
                expires_at = NOW() + INTERVAL '2 hours',
                updated_at = NOW()
            WHERE id = ${testOAuthId}
            RETURNING *
        `;
        
        expect(updated.access_token).toBe('new_access_token');
        expect(updated.refresh_token).toBe('new_refresh_token');
    });

    test('should enforce unique constraint on user_id and provider', async () => {
        try {
            await sql`
                INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
                VALUES (${testUserId}, 'discord', 'discord_test_789')
            `;
            expect(true).toBe(false);
        } catch (error: unknown) {
            expect(getErrorMessage(error)).toContain('unique');
        }
    });

    test('should find expired OAuth tokens', async () => {
        const expired = await sql`
            SELECT * FROM oauth_accounts
            WHERE expires_at < NOW()
        `;
        
        expect(Array.isArray(expired)).toBe(true);
    });

    test('should delete expired OAuth tokens', async () => {
        const [expiredOauth] = await sql`
            INSERT INTO oauth_accounts (user_id, provider, provider_user_id, expires_at)
            VALUES (${testUserId}, 'expired_provider', 'expired_123', NOW() - INTERVAL '1 hour')
            RETURNING id
        `;
        
        await sql`DELETE FROM oauth_accounts WHERE expires_at < NOW()`;
        
        const [deleted] = await sql`
            SELECT * FROM oauth_accounts WHERE id = ${expiredOauth.id}
        `;
        
        expect(deleted).toBeUndefined();
    });

    test('should handle OAuth login flow', async () => {
        const providerUserId = 'discord_new_user_999';
        
        const [existingOAuth] = await sql`
            SELECT user_id FROM oauth_accounts
            WHERE provider = 'discord' AND provider_user_id = ${providerUserId}
        `;
        
        if (!existingOAuth) {
            const [newUser] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${'discord:user999'}, 'oauth-no-password', 1, 500000, 1)
                RETURNING id
            `;
            
            await sql`
                INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
                VALUES (${newUser.id}, 'discord', ${providerUserId})
            `;
            
            const [newOAuth] = await sql`
                SELECT * FROM oauth_accounts
                WHERE provider = 'discord' AND provider_user_id = ${providerUserId}
            `;
            
            expect(newOAuth).toBeDefined();
            expect(newOAuth.user_id).toBe(newUser.id);
            
            await sql`DELETE FROM oauth_accounts WHERE user_id = ${newUser.id}`;
            await sql`DELETE FROM users WHERE id = ${newUser.id}`;
        }
    });
});
