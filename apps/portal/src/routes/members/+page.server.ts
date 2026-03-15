import { sql } from '$lib/server/db';
import { fail } from '@sveltejs/kit';
import { requireOrgManager, requirePortalMember } from '$lib/server/portalAuth';
import type { PageServerLoad, Actions } from './$types';

type MemberRow = {
    id: number;
    username: string;
    role: number;
    quota: number | string;
    used_quota: number | string;
    status: number;
    created_at: string;
};

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requirePortalMember(locals);
    
    // Fetch members and their quotas, scoped to the current org
    const members = await sql`
        SELECT id, username, role, quota, used_quota, status, created_at
        FROM users
        WHERE org_id = ${org.id}
        ORDER BY created_at DESC
    ` as MemberRow[];

    return {
        members: members.map((m: MemberRow) => ({
            id: m.id,
            username: m.username,
            role: m.role,
            quota: Number(m.quota),
            usedQuota: Number(m.used_quota),
            status: m.status,
            createdAt: m.created_at
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
            await sql`
                INSERT INTO users (username, role, quota, used_quota, org_id, password_hash)
                VALUES (${username}, ${role}, ${quota}, 0, ${org.id}, ${passwordHash})
            `;
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

        await sql`
            UPDATE users
            SET role = ${role}, quota = ${quota}, status = ${status}
            WHERE id = ${id as string} AND org_id = ${org.id}
        `;
        return { success: true };
    },

    deleteMember: async ({ request, locals }) => {
        const { org } = requireOrgManager(locals);
        const data = await request.formData();
        const id = data.get('id');

        // Safety: Check if deleting the last owner of the organization
        const [{ count: ownerCount }] = await sql`
            SELECT COUNT(*) FROM users 
            WHERE role = 10 AND status = 1 AND org_id = ${org.id}
        `;
        const [targetMember] = await sql`
            SELECT role FROM users 
            WHERE id = ${id as string} AND org_id = ${org.id}
        `;

        if (Number(ownerCount) <= 1 && targetMember?.role === 10) {
            return fail(400, { error: 'Cannot remove the last Organization Owner' });
        }

        await sql`
            DELETE FROM users 
            WHERE id = ${id as string} AND org_id = ${org.id}
        `;
        return { success: true };
    }
};
