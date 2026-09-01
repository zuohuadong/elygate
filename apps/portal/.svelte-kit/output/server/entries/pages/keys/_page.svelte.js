import { _ as escape_html, c as ensure_array_like, d as spread_props, h as attr } from "../../../chunks/index-server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Key } from "../../../chunks/key.js";
import { t as Trash_2 } from "../../../chunks/trash-2.js";
import "../../../chunks/forms.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/calendar.svelte
function Calendar($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "calendar" },
		props,
		{ iconNode: [
			["path", { "d": "M8 2v4" }],
			["path", { "d": "M16 2v4" }],
			["rect", {
				"width": "18",
				"height": "18",
				"x": "3",
				"y": "4",
				"rx": "2"
			}],
			["path", { "d": "M3 10h18" }]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/shield-alert.svelte
function Shield_alert($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "shield-alert" },
		props,
		{ iconNode: [
			["path", { "d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
			["path", { "d": "M12 8v4" }],
			["path", { "d": "M12 16h.01" }]
		] }
	]));
}
//#endregion
//#region src/routes/keys/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		let revokingId = null;
		$$renderer.push(`<div class="space-y-6"><div class="flex items-center justify-between"><div><h2 class="text-xl font-bold text-white">Organization API Keys</h2> <p class="text-sm text-gray-500">Monitor and manage all API keys created by members of your organization.</p></div></div> <div class="glass-card overflow-hidden"><table class="w-full text-left border-collapse"><thead><tr class="border-b border-[#30363d] bg-white/[0.02]"><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Key Name / Prefix</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Owner</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Last Used</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th></tr></thead><tbody class="divide-y divide-[#30363d]">`);
		const each_array = ensure_array_like(data.tokens);
		if (each_array.length !== 0) {
			$$renderer.push("<!--[-->");
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let token = each_array[$$index];
				$$renderer.push(`<tr class="hover:bg-white/[0.01] transition-colors group"><td class="px-6 py-4"><div class="flex items-center gap-3"><div class="p-2 bg-blue-500/10 rounded-lg text-blue-400">`);
				Key($$renderer, { size: 16 });
				$$renderer.push(`<!----></div> <div class="flex flex-col"><span class="text-sm font-medium text-white">${escape_html(token.name || "Untitled Key")}</span> <span class="text-[10px] font-mono text-gray-500">${escape_html(token.tokenPreview)}</span></div></div></td><td class="px-6 py-4"><div class="flex items-center gap-2"><div class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-300">${escape_html(token.ownerName[0].toUpperCase())}</div> <div class="flex flex-col"><span class="text-xs text-white">${escape_html(token.ownerName)}</span> <span class="text-[10px] text-gray-500">${escape_html(token.ownerRole === 10 ? "Admin" : "Member")}</span></div></div></td><td class="px-6 py-4"><div class="flex items-center gap-2 text-xs text-gray-400">`);
				Calendar($$renderer, { size: 12 });
				$$renderer.push(`<!----> ${escape_html(token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "Never used")}</div></td><td class="px-6 py-4 text-right"><form method="POST" action="?/revokeToken"><input type="hidden" name="tokenId"${attr("value", token.id)}/> <button type="submit" class="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all disabled:opacity-50"${attr("disabled", revokingId === token.id, true)} title="Revoke Key">`);
				if (revokingId === token.id) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<div class="w-4 h-4 border-2 border-red-400 border-t-transparent animate-spin rounded-full"></div>`);
				} else {
					$$renderer.push("<!--[-1-->");
					Trash_2($$renderer, { size: 16 });
				}
				$$renderer.push(`<!--]--></button></form></td></tr>`);
			}
		} else {
			$$renderer.push("<!--[!-->");
			$$renderer.push(`<tr><td colspan="4" class="px-6 py-12 text-center text-gray-500 italic text-sm">No API keys found for this organization.</td></tr>`);
		}
		$$renderer.push(`<!--]--></tbody></table></div> <div class="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg flex gap-3">`);
		Shield_alert($$renderer, {
			size: 18,
			class: "text-yellow-500 shrink-0"
		});
		$$renderer.push(`<!----> <p class="text-xs text-yellow-500/80 leading-relaxed"><strong>Security Advisory:</strong> Revoking a key is permanent and will immediately disconnect any applications using it. 
            Only the hash is stored; original keys cannot be recovered.</p></div></div>`);
	});
}
//#endregion
export { _page as default };
