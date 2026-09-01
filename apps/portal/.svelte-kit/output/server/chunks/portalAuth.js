import { error } from "@sveltejs/kit";
//#region src/lib/server/portalAuth.ts
function requirePortalMember(locals) {
	if (!locals.user || !locals.org) throw error(401, "Unauthorized");
	return {
		user: locals.user,
		org: locals.org
	};
}
function requireOrgManager(locals) {
	const context = requirePortalMember(locals);
	if (context.user.role < 5) throw error(403, "Organization manager access required");
	return context;
}
//#endregion
export { requirePortalMember as n, requireOrgManager as t };
