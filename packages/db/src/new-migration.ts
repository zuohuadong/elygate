import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

function timestamp() {
    const now = new Date();
    const parts = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ];
    return parts.join('');
}

const rawName = process.argv.slice(2).join('-').trim() || 'custom';
const safeName = rawName.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const folderName = `${timestamp()}_${safeName}`;
const target = join(import.meta.dir, '..', 'drizzle', folderName);

if (await stat(target).then(() => true, () => false)) {
    throw new Error(`Migration folder already exists: ${folderName}`);
}

await mkdir(target, { recursive: true });
await Bun.write(join(target, 'migration.sql'), '--> statement-breakpoint\n');

console.log(`[db:generate] created ${folderName}`);
