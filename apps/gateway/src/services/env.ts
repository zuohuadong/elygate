import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { sql } from '@elygate/db';
import { decrypt, encrypt, isEncrypted } from './encryption';

const ENV_PATH = join(process.cwd(), '.env');

// Hardcoded defaults to migrate from
const OLD_ENCRYPTION_SECRET = 'elygate-default-encryption-secret-key';
const OLD_ENCRYPTION_SALT = 'elygate-default-salt';
const OLD_JWT_SECRET = 'super-secret-elygate-jwt-key';

/**
 * Initialize environment variables and perform one-time migration if needed
 */
export async function initEnv() {
    if (existsSync(ENV_PATH)) {
        console.log('✅ Environment configuration (.env) found.');
        return;
    }

    console.log('🚀 Missing .env file. Generating new secure secrets...');

    const newEncryptionSecret = randomBytes(32).toString('hex');
    const newEncryptionSalt = randomBytes(16).toString('hex');
    const newJwtSecret = randomBytes(32).toString('hex');

    // 1. Database Migration: Re-encrypt existing keys if they were encrypted with defaults
    try {
        // Wait for DB to be ready before migration (similar to index.ts init)
        let retries = 0;
        const maxRetries = 10;
        let connected = false;
        while (retries < maxRetries) {
            try {
                await sql`SELECT 1`;
                connected = true;
                break;
            } catch {
                retries++;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        if (connected) {
            const channels = await sql`SELECT id, key FROM channels`;
            if (channels.length > 0) {
                console.log(`📦 Found ${channels.length} channels. Migrating encryption...`);
                
                for (const channel of channels) {
                    if (channel.key && isEncrypted(channel.key)) {
                        // Ensure defaults are set for decryption
                        process.env.ENCRYPTION_SECRET = OLD_ENCRYPTION_SECRET;
                        process.env.ENCRYPTION_SALT = OLD_ENCRYPTION_SALT;
                        
                        const decrypted = decrypt(channel.key);
                        
                        // Temporarily set new secrets to re-encrypt
                        process.env.ENCRYPTION_SECRET = newEncryptionSecret;
                        process.env.ENCRYPTION_SALT = newEncryptionSalt;
                        
                        const reEncrypted = encrypt(decrypted);
                        
                        await sql`UPDATE channels SET key = ${reEncrypted} WHERE id = ${channel.id}`;
                    }
                }
                console.log('✅ Successfully migrated channel encryption.');
            }
        }
    } catch (err: any) {
        console.error('❌ Migration failed:', err.message);
        // We continue anyway so we don't block startup on a fresh install
    }

    // 2. Generate .env file
    const envContent = [
        '# Elygate Environment Configuration',
        '# Generated automatically on first start',
        '',
        `ENCRYPTION_SECRET=${newEncryptionSecret}`,
        `ENCRYPTION_SALT=${newEncryptionSalt}`,
        `JWT_SECRET=${newJwtSecret}`,
        '',
        '# Database Configuration',
        `DATABASE_URL=${process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/elygate'}`,
        '',
        '# Server Configuration',
        'PORT=3000',
        'HOSTNAME=0.0.0.0',
    ].join('\n');

    try {
        writeFileSync(ENV_PATH, envContent);
        console.log(`✅ Generated new .env file at: ${ENV_PATH}`);
        
        // Update current process env
        process.env.ENCRYPTION_SECRET = newEncryptionSecret;
        process.env.ENCRYPTION_SALT = newEncryptionSalt;
        process.env.JWT_SECRET = newJwtSecret;
    } catch (err: any) {
        console.error('❌ Failed to write .env file:', err.message);
    }
}
