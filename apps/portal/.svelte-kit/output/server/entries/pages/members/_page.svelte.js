import { _ as escape_html, c as ensure_array_like, d as spread_props, f as stringify, h as attr, i as attr_style, o as derived, r as attr_class } from "../../../chunks/index-server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { n as Search, t as Funnel } from "../../../chunks/funnel.js";
import { t as Trash_2 } from "../../../chunks/trash-2.js";
import "../../../chunks/forms.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/user-plus.svelte
function User_plus($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "user-plus" },
		props,
		{ iconNode: [
			["path", { "d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
			["circle", {
				"cx": "9",
				"cy": "7",
				"r": "4"
			}],
			["line", {
				"x1": "19",
				"x2": "19",
				"y1": "8",
				"y2": "14"
			}],
			["line", {
				"x1": "22",
				"x2": "16",
				"y1": "11",
				"y2": "11"
			}]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/pen.svelte
function Pen($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "pen" },
		props,
		{ iconNode: [["path", { "d": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }]] }
	]));
}
//#endregion
//#region src/routes/members/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		let searchQuery = "";
		let filteredMembers = derived(() => data.members.filter((member) => member.username.toLowerCase().includes(searchQuery.toLowerCase())));
		const getRoleBadge = (role) => {
			if (role >= 10) return "bg-red-500/10 text-red-400 border-red-500/20";
			if (role >= 5) return "bg-blue-500/10 text-blue-400 border-blue-500/20";
			return "bg-gray-500/10 text-gray-400 border-gray-500/20";
		};
		const getRoleName = (role) => {
			if (role >= 10) return "Org Owner";
			if (role >= 5) return "Manager";
			return "Member";
		};
		$$renderer.push(`<div class="space-y-6"><div class="flex items-center justify-between gap-4"><div class="flex-1 relative max-w-md">`);
		Search($$renderer, {
			class: "absolute left-3 top-1/2 -translate-y-1/2 text-gray-500",
			size: 18
		});
		$$renderer.push(`<!----> <input type="text"${attr("value", searchQuery)} placeholder="Search by username or email..." class="w-full bg-[#161b22] border border-[#30363d] rounded-lg py-2 pl-10 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm outline-none"/></div> <div class="flex items-center gap-3"><button class="flex items-center gap-2 px-3 py-2 bg-white/5 border border-[#30363d] rounded-lg text-sm hover:bg-white/10 transition-all">`);
		Funnel($$renderer, { size: 16 });
		$$renderer.push(`<!----> Filters</button> <button class="btn-primary flex items-center gap-2">`);
		User_plus($$renderer, { size: 18 });
		$$renderer.push(`<!----> Add Member</button></div></div> <div class="glass-card overflow-hidden"><table class="w-full text-left border-collapse"><thead><tr class="border-b border-[#30363d] bg-white/[0.02]"><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Member</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Quota Status</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th></tr></thead><tbody class="divide-y divide-[#30363d]"><!--[-->`);
		const each_array = ensure_array_like(filteredMembers());
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let member = each_array[$$index];
			$$renderer.push(`<tr class="hover:bg-white/[0.02] transition-colors group"><td class="px-6 py-4"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-xs uppercase">${escape_html(member.username[0])}</div> <div class="overflow-hidden"><p class="text-sm font-medium text-white truncate">${escape_html(member.username)}</p> <p class="text-[10px] text-gray-500">Joined ${escape_html(new Date(member.createdAt).toLocaleDateString())}</p></div></div></td><td class="px-6 py-4"><span${attr_class(`px-2 py-0.5 rounded-full text-[10px] font-bold border ${stringify(getRoleBadge(member.role))}`)}>${escape_html(getRoleName(member.role))}</span></td><td class="px-6 py-4"><div class="flex flex-col gap-1 w-32"><div class="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden"><div class="h-full bg-blue-500 rounded-full"${attr_style(`width: ${stringify((member.quota > 0 ? member.usedQuota / member.quota * 100 : 0).toFixed(1))}%`)}></div></div> <span class="text-[10px] font-mono text-gray-500">${escape_html((member.usedQuota / 1e6).toFixed(2))}M / ${escape_html((member.quota / 1e6).toFixed(2))}M</span></div></td><td class="px-6 py-4 text-right"><div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button class="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-all">`);
			Pen($$renderer, { size: 16 });
			$$renderer.push(`<!----></button> <button class="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all">`);
			Trash_2($$renderer, { size: 16 });
			$$renderer.push(`<!----></button></div></td></tr>`);
		}
		$$renderer.push(`<!--]--></tbody></table></div></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _page as default };
