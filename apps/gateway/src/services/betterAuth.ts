import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { sql } from "@elygate/db";

export const auth = betterAuth({
    basePath: "/api/auth/better",
    database: {
        type: "postgres",
        async query(sqlQuery: string, values?: any[]) {
            const res = await sql.unsafe(sqlQuery, values ?? []);
            return { rows: Array.isArray(res) ? res : [] };
        }
    },
    advanced: {
        generateId: "serial",
    },
    user: {
        modelName: "users",
        additionalFields: {
            role: { type: "number", required: false, defaultValue: 1 },
            quota: { type: "number", required: false, defaultValue: 0 },
            used_quota: { type: "number", required: false, defaultValue: 0 },
            password_hash: { type: "string", required: false },
            status: { type: "number", required: false, defaultValue: 1 },
        }
    },
    emailAndPassword: {
        enabled: true
    },
    plugins: [
        username()
    ]
});
