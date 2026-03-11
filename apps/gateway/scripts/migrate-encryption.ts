import crypto from 'crypto';
import fs from 'fs';
import { join } from 'path';
import { sql } from '@elygate/db';

const OLD_SECRET = 'elygate-default-encryption-secret-key';
const OLD_SALT = 'elygate-default-salt';

async function main() {
    const envContent = fs.readFileSync(join(process.cwd(), '../../.env'), 'utf-8');
    const newSecret = envContent.match(/ENCRYPTION_SECRET=(.+)/)?.[1];
    const newSalt = envContent.match(/ENCRYPTION_SALT=(.+)/)?.[1];
    
    console.log('New secret:', newSecret?.substring(0, 10) + '...');
    console.log('New salt:', newSalt?.substring(0, 10) + '...');
    
    const result = await sql`SELECT id, key FROM channels`;
    console.log('Found channels:', result.length);
    
    let migrated = 0;
    let failed = 0;
    
    for (const channel of result) {
        if (channel.key && channel.key.includes(':')) {
            const oldKey = crypto.scryptSync(OLD_SECRET, OLD_SALT, 32);
            const parts = channel.key.split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encrypted = parts[2];
            
            try {
                const decipher = crypto.createDecipheriv('aes-256-gcm', oldKey, iv);
                decipher.setAuthTag(authTag);
                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                
                const newKey = crypto.scryptSync(newSecret!, newSalt!, 32);
                const newIv = crypto.randomBytes(16);
                const cipher = crypto.createCipheriv('aes-256-gcm', newKey, newIv);
                let newEncrypted = cipher.update(decrypted, 'utf8', 'hex');
                newEncrypted += cipher.final('hex');
                const newAuthTag = cipher.getAuthTag();
                
                const newKeyStr = newIv.toString('hex') + ':' + newAuthTag.toString('hex') + ':' + newEncrypted;
                
                await sql`UPDATE channels SET key = ${newKeyStr} WHERE id = ${channel.id}`;
                console.log('Migrated channel:', channel.id);
                migrated++;
            } catch (e: any) {
                console.log('Failed channel:', channel.id, e.message);
                failed++;
            }
        }
    }
    
    console.log('\nMigration complete!');
    console.log('Migrated:', migrated);
    console.log('Failed:', failed);
    
    process.exit(0);
}

main().catch(console.error);
