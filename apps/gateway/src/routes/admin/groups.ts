import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { getErrorMessage } from '../../utils/error';
import { db, schema } from '@elygate/db';
import { userGroups, users } from '@elygate/db/schema';
import { eq, desc } from 'drizzle-orm';
import { refreshAllCaches } from './index';

export const groupsRouter = new Elysia()
    .get('/user-groups', async () => {
        return await db.select().from(userGroups).orderBy(desc(userGroups.createdAt));
    })
    .get('/user-groups/:key', async ({ params: { key }, set }: ElysiaCtx) => {
        const [group] = await db.select().from(userGroups).where(eq(userGroups.key, key)).limit(1);
        if (!group) {
            set.status = 404;
            return { success: false, message: 'Group not found' };
        }
        return group;
    })
    .post('/user-groups', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await db.insert(userGroups).values({
                key: b.key,
                name: b.name,
                description: b.description || '',
                allowedChannelTypes: b.allowedChannelTypes || [],
                deniedChannelTypes: b.deniedChannelTypes || [],
                allowedModels: b.allowedModels || [],
                deniedModels: b.deniedModels || [],
                allowedPackages: b.allowedPackages || [],
                status: b.status || 1,
            }).returning();
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
            const [oldGroup] = await db.select().from(userGroups).where(eq(userGroups.key, key)).limit(1);
            if (!oldGroup) {
                set.status = 404;
                return { success: false, message: 'Group not found' };
            }

            const [result] = await db.update(userGroups).set({
                name: b.name ?? oldGroup.name,
                description: b.description ?? oldGroup.description,
                allowedChannelTypes: b.allowedChannelTypes || oldGroup.allowedChannelTypes,
                deniedChannelTypes: b.deniedChannelTypes || oldGroup.deniedChannelTypes,
                allowedModels: b.allowedModels || oldGroup.allowedModels,
                deniedModels: b.deniedModels || oldGroup.deniedModels,
                allowedPackages: b.allowedPackages || oldGroup.allowedPackages,
                status: b.status ?? oldGroup.status,
                updatedAt: new Date(),
            }).where(eq(userGroups.key, key)).returning();
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
            const [userDep] = await db.select({ id: users.id }).from(users).where(eq(users.group, key)).limit(1);
            if (userDep) {
                set.status = 400;
                return { success: false, message: 'Cannot delete group with active users' };
            }
            await db.delete(userGroups).where(eq(userGroups.key, key));
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
