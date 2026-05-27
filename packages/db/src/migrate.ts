import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { db } from './index';

await migrate(db, {
    migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
});

console.log('[db:migrate] completed');
