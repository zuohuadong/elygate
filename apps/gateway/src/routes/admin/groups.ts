import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { getErrorMessage } from '../../utils/error';
import { sql } from '@elygate/db';
import { memoryCache } from '../../services/cache';
import { refreshAllCaches } from './index';

export const groupsRouter = new Elysia()
    .get('/user-groups', async () => {
        const groups = await sql`SELECT * FROM user_groups ORDER BY created_at DESC`;
        return groups;
    })
    .post('/user-groups', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await sql`
                INSERT INTO user_groups (key, name, description, allowed_channel_types, denied_channel_types, allowed_models, denied_models, allowed_packages, status)
                VALUES (${b.key}, ${b.name}, ${b.description || ''}, ${b.allowedChannelTypes ? JSON.stringify(b.allowedChannelTypes) : '[]'}, ${b.deniedChannelTypes ? JSON.stringify(b.deniedChannelTypes) : '[]'}, ${b.allowedModels ? JSON.stringify(b.allowedModels) : '[]'}, ${b.deniedModels ? JSON.stringify(b.deniedModels) : '[]'}, ${b.allowedPackages ? JSON.stringify(b.allowedPackages) : '[]'}, ${b.status || 1})
                RETURNING *
            `;
            await refreshAllCaches();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            key: t.String(),
            name: t.String(),
            description: t.Optional(t.String()),
            allowedChannelTypes: t.Optional(t.Array(t.Number())),
            deniedChannelTypes: t.Optional(t.Array(t.Number())),
            allowedModels: t.Optional(t.Array(t.String())),
            deniedModels: t.Optional(t.Array(t.String())),
            allowedPackages: t.Optional(t.Array(t.Number())),
            status: t.Optional(t.Number())
        })
    })
    .put('/user-groups/:key', async ({ params: { key }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [oldGroup] = await sql`SELECT * FROM user_groups WHERE key = ${key} LIMIT 1`;
            if (!oldGroup) {
                set.status = 404;
                return { success: false, message: 'Group not found' };
            }

            const [result] = await sql`
                UPDATE user_groups 
                SET name = ${b.name ?? oldGroup.name},
                    description = ${b.description ?? oldGroup.description},
                    allowed_channel_types = ${b.allowedChannelTypes ? JSON.stringify(b.allowedChannelTypes) : oldGroup.allowed_channel_types},
                    denied_channel_types = ${b.deniedChannelTypes ? JSON.stringify(b.deniedChannelTypes) : oldGroup.denied_channel_types},
                    allowed_models = ${b.allowedModels ? JSON.stringify(b.allowedModels) : oldGroup.allowed_models},
                    denied_models = ${b.deniedModels ? JSON.stringify(b.deniedModels) : oldGroup.denied_models},
                    allowed_packages = ${b.allowedPackages ? JSON.stringify(b.allowedPackages) : oldGroup.allowed_packages},
                    status = ${b.status ?? oldGroup.status},
                    updated_at = NOW()
                WHERE key = ${key}
                RETURNING *
            `;
            await refreshAllCaches();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })
    .delete('/user-groups/:key', async ({ params: { key }, set }: ElysiaCtx) => {
        try {
            if (key === 'default') {
                set.status = 400;
                return { success: false, message: 'Cannot delete system default groups' };
            }
            const [userDep] = await sql`SELECT id FROM users WHERE "group" = ${key} LIMIT 1`;
            if (userDep) {
                set.status = 400;
                return { success: false, message: 'Cannot delete group with active users' };
            }
            await sql`DELETE FROM user_groups WHERE key = ${key}`;
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
