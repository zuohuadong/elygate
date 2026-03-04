import { betterAuth } from "better-auth";
import { sveltekitCookies, svelteKitHandler } from "better-auth/svelte-kit";
import { username } from "better-auth/plugins";
import { getRequestEvent } from "$app/server";
import { sql } from "@elygate/db";

export const auth = betterAuth({
    database: {
        async query(sql_query, values) {
            const res = await sql.unsafe(sql_query, values);
            return { rows: res };
        },
        type: "postgres"
    },
    advanced: {
        generateId: "serial",
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
});
