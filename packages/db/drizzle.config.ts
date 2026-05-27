import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/elygate';

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/schema.ts',
    out: './drizzle',
    dbCredentials: {
        url,
    },
    strict: true,
    verbose: true,
});
