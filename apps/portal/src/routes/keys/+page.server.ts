import { sql } from '$lib/server/db';
import { fail } from '@sveltejs/kit';
import { requireOrgManager } from '$lib/server/portalAuth';
import type { PageServerLoad, Actions } from './$types';

type TokenRow = {
    id: number;
    name: string;
    tokenPreview: string | null;
    createdAt: string | Date;
    lastUsedAt: string | Date | null;
    ownerName: string;
    ownerRole: number;
};

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requireOrgManager(locals);

    // Fetch all tokens for the org, joining with users to see owners
    const tokens = await sql`
        SELECT 
            t.id,
            t.name,
            LEFT(t.key, 8) as "tokenPreview",
            t.created_at as "createdAt",
            MAX(l.created_at) as "lastUsedAt",
            u.username as "ownerName",
            u.role as "ownerRole"
        FROM tokens t
        JOIN users u ON t.user_id = u.id
        LEFT JOIN logs l ON l.token_id = t.id
        WHERE u.org_id = ${org.id}
        GROUP BY t.id, t.name, t.key, t.created_at, u.username, u.role
        ORDER BY t.created_at DESC
    ` as TokenRow[];

    return {
        tokens: tokens.map((token) => ({
            ...token,
            // Mask the token hash for security, just show a preview
            tokenPreview: token.tokenPreview ? `${token.tokenPreview}...` : 'N/A'
        }))
    };
};

export const actions: Actions = {
    revokeToken: async ({ request, locals }) => {
        const { org } = requireOrgManager(locals);
        const data = await request.formData();
        const tokenId = data.get('tokenId');

        if (!tokenId) return fail(400, { message: 'Token ID is required' });

        try {
            // Verify the token belongs to a member of THIS org before deleting
            await sql`
                DELETE FROM tokens 
                WHERE id = ${tokenId as string} 
                AND user_id IN (SELECT id FROM users WHERE org_id = ${org.id})
            `;
            return { success: true };
        } catch (err) {
            console.error('Failed to revoke token:', err);
            return fail(500, { message: 'Failed to revoke token' });
        }
    }
};
