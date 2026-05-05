import { db, sql } from '$lib/server/db';
import { error, redirect } from '@sveltejs/kit';
import { sessions, users, organizations } from '@elygate/db/schema';
import { eq, and, gt } from '@elygate/db/operators';
import type { LayoutServerLoad } from './$types';

type SessionRow = {
	user_id: number;
	username: string;
	role: number;
	org_id: number | null;
	org_name: string | null;
	org_total_quota: number | string | null;
	org_used_quota: number | string | null;
};

export const load: LayoutServerLoad = async ({ cookies, url }) => {
    const sessionToken = cookies.get('auth_session');
    
    if (!sessionToken) {
        if (url.pathname === '/login') {
            return { user: null, org: null };
        }
        throw redirect(302, '/login'); 
    }

    // Complex JOIN across session + users + organizations — use raw SQL
    const [session] = await sql`
        SELECT s.user_id, u.username, u.role, u.org_id, o.name as org_name, o.quota as org_total_quota, o.used_quota as org_used_quota
        FROM session s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN organizations o ON u.org_id = o.id
        WHERE s.token = ${sessionToken} AND s.expires_at > NOW()
        LIMIT 1
    ` as SessionRow[];

    if (!session) {
        cookies.delete('auth_session', { path: '/' });
        if (url.pathname === '/login') {
            return { user: null, org: null };
        }
        throw redirect(302, '/login');
    }

    if (url.pathname === '/login') {
        throw redirect(302, '/');
    }

    if (!session.org_id && session.role !== 10) {
        throw error(403, 'This portal is for enterprise members only.');
    }

    return {
        user: {
            id: session.user_id,
            username: session.username,
            role: session.role
        },
        org: {
            id: session.org_id,
            name: session.org_name ?? 'Unknown Organization',
            totalQuota: Number(session.org_total_quota ?? 0),
            usedQuota: Number(session.org_used_quota ?? 0)
        }
    };
};
