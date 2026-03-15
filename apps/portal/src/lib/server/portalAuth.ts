import { error } from '@sveltejs/kit';

type PortalUser = {
    id: number;
    username: string;
    role: number;
};

type PortalOrg = {
    id: number;
    name: string;
};

type PortalLocals = {
    user?: PortalUser;
    org?: PortalOrg;
};

export function requirePortalMember(locals: PortalLocals) {
    if (!locals.user || !locals.org) {
        throw error(401, 'Unauthorized');
    }

    return {
        user: locals.user,
        org: locals.org
    };
}

export function requireOrgManager(locals: PortalLocals) {
    const context = requirePortalMember(locals);

    if (context.user.role < 5) {
        throw error(403, 'Organization manager access required');
    }

    return context;
}
