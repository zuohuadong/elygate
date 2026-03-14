import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

type MemberRow = {
    id: number;
    username: string;
    role: number;
    quota: number | string;
    used_quota: number | string;
    status: number;
    created_at: string | Date;
};

export const load: PageServerLoad = async ({ parent }) => {
    const { org } = await parent();

    const members = await sql`
        SELECT id, username, role, quota, used_quota, status, created_at
        FROM users
        WHERE org_id = ${org.id}
        ORDER BY created_at DESC
    ` as MemberRow[];

    return {
        members: members.map((member) => ({
            id: member.id,
            username: member.username,
            role: member.role,
            quota: Number(member.quota),
            usedQuota: Number(member.used_quota),
            status: member.status,
            createdAt: new Date(member.created_at).toISOString()
        }))
    };
};
