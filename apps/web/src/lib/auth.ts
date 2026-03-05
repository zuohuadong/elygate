import { betterAuth } from "better-auth";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { username } from "better-auth/plugins";
import { getRequestEvent } from "$app/server";
import { building } from "$app/environment";

async function getPgAdapter() {
    const { Pool } = await import("pg");
    return new Pool({
        connectionString: process.env.DATABASE_URL
    });
}

export const auth = !building ? betterAuth({
    database: async () => {
        const pool = await getPgAdapter();
        return pool;
    },
    user: {
        modelName: "users",
        additionalFields: {
            role: { type: "number", required: false, defaultValue: 1 },
            quota: { type: "number", required: false, defaultValue: 0 },
            used_quota: { type: "number", required: false, defaultValue: 0 }
        }
    },
    emailAndPassword: {
        enabled: true
    },
    plugins: [
        username(),
        sveltekitCookies(getRequestEvent)
    ]
}) : {} as any;
