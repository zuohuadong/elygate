import { existsSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
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
 * Parse .env file and return key-value pairs
 */
function parseEnvFile(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
                result[key.trim()] = valueParts.join('=').trim();
            }
        }
    }
    return result;
}

/**
 * Initialize environment variables and perform one-time migration if needed
 */
export async function initEnv() {
    let needsMigration = false;
    let envVars: Record<string, string> = {};
    
    // Check if .env exists and parse it
    if (existsSync(ENV_PATH)) {
        console.log('✅ Environment configuration (.env) found.');
        const content = readFileSync(ENV_PATH, 'utf-8');
        envVars = parseEnvFile(content);
        
        // Check if encryption keys are missing
        if (!envVars.ENCRYPTION_SECRET || !envVars.ENCRYPTION_SALT) {
            console.log('⚠️  Missing encryption keys in .env. Will generate new ones and migrate data...');
            needsMigration = true;
        }
    } else {
        console.log('🚀 Missing .env file. Generating new secure secrets...');
        needsMigration = true;
    }
    
    // If no migration needed, return early
    if (!needsMigration) {
        return;
    }
    
    // Generate new secrets
    const newEncryptionSecret = envVars.ENCRYPTION_SECRET || randomBytes(32).toString('hex');
    const newEncryptionSalt = envVars.ENCRYPTION_SALT || randomBytes(16).toString('hex');
    const newJwtSecret = envVars.JWT_SECRET || randomBytes(32).toString('hex');

    // 1. Database Migration: Re-encrypt existing keys if they were encrypted with defaults
    try {
        // Wait for DB to be ready before migration
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
    }

    // 2. Update or create .env file
    const newEnvVars = {
        ...envVars,
        ENCRYPTION_SECRET: newEncryptionSecret,
        ENCRYPTION_SALT: newEncryptionSalt,
        JWT_SECRET: newJwtSecret,
    };
    
    const envContent = [
        '# Elygate Environment Configuration',
        '# Generated automatically on first start',
        '',
        `ENCRYPTION_SECRET=${newEnvVars.ENCRYPTION_SECRET}`,
        `ENCRYPTION_SALT=${newEnvVars.ENCRYPTION_SALT}`,
        `JWT_SECRET=${newEnvVars.JWT_SECRET}`,
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
