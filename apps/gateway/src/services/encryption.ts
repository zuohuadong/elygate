/**
 * Encryption Service
 * Provides AES-256-GCM encryption for sensitive data like API keys
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Get encryption key from environment or generate one
 */
function getEncryptionKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET || 'elygate-default-encryption-secret-key';
    const salt = process.env.ENCRYPTION_SALT || 'elygate-default-salt';
    
    // Derive a 32-byte key using scrypt
    return scryptSync(secret, salt, 32);
}

/**
 * Encrypt sensitive data
 */
export function encrypt(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt sensitive data
 */
export function decrypt(ciphertext: string): string {
    const key = getEncryptionKey();
    
    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 3) {
            // Not encrypted, return as-is (backward compatibility)
            return ciphertext;
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        // If decryption fails, assume it's not encrypted (backward compatibility)
        console.warn('[Encryption] Failed to decrypt, returning as-is:', error);
        return ciphertext;
    }
}

/**
 * Check if a string is encrypted
 */
export function isEncrypted(value: string): boolean {
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    
    try {
        Buffer.from(parts[0], 'hex');
        Buffer.from(parts[1], 'hex');
        return parts[0].length === IV_LENGTH * 2 && parts[1].length === AUTH_TAG_LENGTH * 2;
    } catch {
        return false;
    }
}

/**
 * Encrypt channel keys (multiple keys separated by newline)
 */
export function encryptChannelKeys(keys: string): string {
    const keyList = keys.split('\n').map(k => k.trim()).filter(Boolean);
    const encryptedKeys = keyList.map(k => encrypt(k));
    return encryptedKeys.join('\n');
}

/**
 * Decrypt channel keys (multiple keys separated by newline)
 */
export function decryptChannelKeys(encryptedKeys: string): string {
    const keyList = encryptedKeys.split('\n').map(k => k.trim()).filter(Boolean);
    const decryptedKeys = keyList.map(k => decrypt(k));
    return decryptedKeys.join('\n');
}
