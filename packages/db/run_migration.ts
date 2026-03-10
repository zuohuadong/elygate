import { sql } from './src/index.ts';

async function main() {
    try {
        await sql.file('./migrations/002_add_packages_and_rate_limits.sql');
        console.log('Migration completed successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    }
    process.exit(0);
}

main();
