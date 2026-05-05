import { db, sql } from '$lib/server/db';
import { fail } from '@sveltejs/kit';
import { requireOrgManager, requirePortalMember } from '$lib/server/portalAuth';
import { users } from '@elygate/db/schema';
import { eq, desc, and, count } from '@elygate/db/operators';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requirePortalMember(locals);
    
    const members = await db.select({
        id: users.id,
        username: users.username,
        role: users.role,
        quota: users.quota,
        usedQuota: users.usedQuota,
        status: users.status,
        createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.orgId, org.id))
    .orderBy(desc(users.createdAt));

    return {
        members: members.map((m) => ({
            id: m.id,
            username: m.username,
            role: m.role,
            quota: Number(m.quota),
            usedQuota: Number(m.usedQuota),
            status: m.status,
            createdAt: m.createdAt
        }))
    };
};

export const actions: Actions = {
    addMember: async ({ request, locals }) => {
        const { org } = requireOrgManager(locals);
        const data = await request.formData();
        const username = data.get('username') as string;
        const role = parseInt(data.get('role') as string);
        const quota = parseInt(data.get('quota') as string);
        const password = data.get('password') as string;

        if (!username) return fail(400, { message: 'Username is required' });
        if (!password || password.length < 8) return fail(400, { message: 'Password must be at least 8 characters' });

        try {
            const passwordHash = await Bun.password.hash(password);
            await db.insert(users).values({
                username,
                role,
                quota,
                usedQuota: 0,
                orgId: org.id,
                passwordHash,
            });
            return { success: true };
        } catch (err) {
            console.error('Failed to add member:', err);
            return fail(500, { message: 'Failed to add member' });
        }
    },

    updateMember: async ({ request, locals }) => {
        const { org } = requireOrgManager(locals);
        const data = await request.formData();
        const id = data.get('id');
        const role = parseInt(data.get('role') as string);
        const quota = parseInt(data.get('quota') as string);
        const status = parseInt(data.get('status') as string);

        await db.update(users)
            .set({ role, quota, status })
            .where(and(eq(users.id, Number(id)), eq(users.orgId, org.id)));
        return { success: true };
    },

    deleteMember: async ({ request, locals }) => {
        const { org } = requireOrgManager(locals);
        const data = await request.formData();
        const id = data.get('id');

        const [{ count: ownerCount }] = await db.select({ count: count() })
            .from(users)
            .where(and(eq(users.role, 10), eq(users.status, 1), eq(users.orgId, org.id)));
        const [targetMember] = await db.select({ role: users.role })
            .from(users)
            .where(and(eq(users.id, Number(id)), eq(users.orgId, org.id)));

        if (Number(ownerCount) <= 1 && targetMember?.role === 10) {
            return fail(400, { error: 'Cannot remove the last Organization Owner' });
        }

        await db.delete(users)
            .where(and(eq(users.id, Number(id)), eq(users.orgId, org.id)));
        return { success: true };
    }
};
