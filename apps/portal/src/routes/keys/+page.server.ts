import { db } from '$lib/server/db';
import { fail } from '@sveltejs/kit';
import { requireOrgManager } from '$lib/server/portalAuth';
import { tokens, users, logs } from '@elygate/db/schema';
import { eq, desc, and, sql as drizzleSql, inArray, max } from '@elygate/db/operators';
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

    const tokenRows = await db.select({
        id: tokens.id,
        name: tokens.name,
        tokenPreview: drizzleSql<string>`LEFT(${tokens.key}, 8)`,
        createdAt: tokens.createdAt,
        lastUsedAt: max(logs.createdAt),
        ownerName: users.username,
        ownerRole: users.role,
    })
    .from(tokens)
    .innerJoin(users, eq(tokens.userId, users.id))
    .leftJoin(logs, eq(logs.tokenId, tokens.id))
    .where(eq(users.orgId, org.id))
    .groupBy(tokens.id, tokens.name, tokens.key, tokens.createdAt, users.username, users.role)
    .orderBy(desc(tokens.createdAt)) as TokenRow[];

    return {
        tokens: tokenRows.map((token) => ({
            ...token,
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
            // Find org member user IDs, then delete token belonging to one of them
            const orgUsers = await db.select({ id: users.id })
                .from(users)
                .where(eq(users.orgId, org.id));
            const orgUserIds = orgUsers.map(u => u.id);

            await db.delete(tokens)
                .where(and(eq(tokens.id, Number(tokenId)), inArray(tokens.userId, orgUserIds)));
            return { success: true };
        } catch (err) {
            console.error('Failed to revoke token:', err);
            return fail(500, { message: 'Failed to revoke token' });
        }
    }
};
