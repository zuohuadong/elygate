import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { db, sql } from '@elygate/db';
import { channels } from '@elygate/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt, encrypt, isEncrypted } from './encryption';

const ENV_PATH = join(process.cwd(), '.env');

const OLD_ENCRYPTION_SECRET = 'elygate-default-encryption-secret-key';
const OLD_ENCRYPTION_SALT = 'elygate-default-salt';
const OLD_JWT_SECRET = 'super-secret-elygate-jwt-key';

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

export async function initEnv(): Promise<void> {
    let needsMigration = false;
    let envVars: Record<string, string> = {};
    
    if (existsSync(ENV_PATH)) {
        log.info('✅ Environment configuration (.env) found.');
        const content = readFileSync(ENV_PATH, 'utf-8');
        envVars = parseEnvFile(content);
        
        if (!envVars.ENCRYPTION_SECRET || !envVars.ENCRYPTION_SALT) {
            log.info('⚠️  Missing encryption keys in .env. Will generate new ones and migrate data...');
            needsMigration = true;
        }
    } else {
        log.info('🚀 Missing .env file. Generating new secure secrets...');
        needsMigration = true;
    }
    
    if (!needsMigration) {
        return;
    }
    
    const newEncryptionSecret = envVars.ENCRYPTION_SECRET || randomBytes(32).toString('hex');
    const newEncryptionSalt = envVars.ENCRYPTION_SALT || randomBytes(16).toString('hex');
    const newJwtSecret = envVars.JWT_SECRET || randomBytes(32).toString('hex');

    try {
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
            const allChannels = await db.select({
                id: channels.id,
                key: channels.key,
            }).from(channels);

            if (allChannels.length > 0) {
                log.info(`📦 Found ${allChannels.length} channels. Migrating encryption...`);
                
                for (const channel of allChannels) {
                    if (channel.key && isEncrypted(channel.key)) {
                        process.env.ENCRYPTION_SECRET = OLD_ENCRYPTION_SECRET;
                        process.env.ENCRYPTION_SALT = OLD_ENCRYPTION_SALT;
                        
                        const decrypted = decrypt(channel.key);
                        
                        process.env.ENCRYPTION_SECRET = newEncryptionSecret;
                        process.env.ENCRYPTION_SALT = newEncryptionSalt;
                        
                        const reEncrypted = encrypt(decrypted);
                        
                        await db.update(channels)
                            .set({ key: reEncrypted })
                            .where(eq(channels.id, channel.id));
                    }
                }
                log.info('✅ Successfully migrated channel encryption.');
            }
        }
    } catch (err: unknown) {
        log.error('❌ Migration failed:', getErrorMessage(err));
    }

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
        log.info(`✅ Generated new .env file at: ${ENV_PATH}`);
        
        process.env.ENCRYPTION_SECRET = newEncryptionSecret;
        process.env.ENCRYPTION_SALT = newEncryptionSalt;
        process.env.JWT_SECRET = newJwtSecret;
    } catch (err: unknown) {
        log.error('❌ Failed to write .env file:', getErrorMessage(err));
    }
}
