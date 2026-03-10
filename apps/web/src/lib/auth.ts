
import { betterAuth } from "better-auth";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { username } from "better-auth/plugins";
import { getRequestEvent } from "$app/server";
import { building } from "$app/environment";
import { sql } from "@elygate/db";

export const auth = !building ? betterAuth({
    database: sql as any,
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
