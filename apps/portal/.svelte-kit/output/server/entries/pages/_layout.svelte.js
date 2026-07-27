import { _ as escape_html, c as ensure_array_like, d as spread_props, f as stringify, h as attr, i as attr_style, o as derived, r as attr_class } from "../../chunks/index-server.js";
import { t as page } from "../../chunks/state.js";
import { t as Icon } from "../../chunks/Icon.js";
import { n as Activity, t as Users } from "../../chunks/users.js";
import { t as Shield_check } from "../../chunks/shield-check.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/layout-dashboard.svelte
function Layout_dashboard($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "layout-dashboard" },
		props,
		{ iconNode: [
			["rect", {
				"width": "7",
				"height": "9",
				"x": "3",
				"y": "3",
				"rx": "1"
			}],
			["rect", {
				"width": "7",
				"height": "5",
				"x": "14",
				"y": "3",
				"rx": "1"
			}],
			["rect", {
				"width": "7",
				"height": "9",
				"x": "14",
				"y": "12",
				"rx": "1"
			}],
			["rect", {
				"width": "7",
				"height": "5",
				"x": "3",
				"y": "16",
				"rx": "1"
			}]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/log-out.svelte
function Log_out($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "log-out" },
		props,
		{ iconNode: [
			["path", { "d": "m16 17 5-5-5-5" }],
			["path", { "d": "M21 12H9" }],
			["path", { "d": "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/settings.svelte
function Settings($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "settings" },
		props,
		{ iconNode: [["path", { "d": "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }], ["circle", {
			"cx": "12",
			"cy": "12",
			"r": "3"
		}]] }
	]));
}
//#endregion
//#region src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data, children } = $$props;
		const navItems = [
			{
				name: "Dashboard",
				path: "/",
				icon: Layout_dashboard
			},
			{
				name: "Audit Logs",
				path: "/logs",
				icon: Activity
			},
			{
				name: "Team Members",
				path: "/members",
				icon: Users
			},
			{
				name: "Policy Control",
				path: "/policy",
				icon: Shield_check
			},
			{
				name: "Org Settings",
				path: "/settings",
				icon: Settings
			}
		];
		const currentPath = derived(() => page.url.pathname);
		if (data.user) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex min-h-screen bg-[#0d1117] text-gray-200"><aside class="w-64 border-r border-[#30363d] bg-[#0d1117] flex flex-col sticky top-0 h-screen"><div class="p-6"><div class="flex items-center gap-3 mb-8"><div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">E</div> <span class="text-xl font-bold tracking-tight text-white">Elygate <span class="text-blue-500">Portal</span></span></div> <nav class="space-y-1"><!--[-->`);
			const each_array = ensure_array_like(navItems);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let item = each_array[$$index];
				$$renderer.push(`<a${attr("href", item.path)}${attr_class(`nav-item ${currentPath() === item.path ? "nav-item-active" : ""}`)}>`);
				if (item.icon) {
					$$renderer.push("<!--[-->");
					item.icon($$renderer, { size: 20 });
					$$renderer.push("<!--]-->");
				} else {
					$$renderer.push("<!--[!-->");
					$$renderer.push("<!--]-->");
				}
				$$renderer.push(` <span>${escape_html(item.name)}</span></a>`);
			}
			$$renderer.push(`<!--]--></nav></div> <div class="mt-auto p-6 border-t border-[#30363d]"><div class="flex items-center gap-3 mb-4"><div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold animate-pulse">${escape_html(data.user.username[0].toUpperCase())}</div> <div class="overflow-hidden"><p class="text-sm font-medium text-white truncate">${escape_html(data.user.username)}</p> <p class="text-xs text-gray-400 truncate">${escape_html(data.org?.name)}</p></div></div> <button class="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors">`);
			Log_out($$renderer, { size: 16 });
			$$renderer.push(`<!----> <span>Sign Out</span></button></div></aside> <main class="flex-1 flex flex-col min-w-0 overflow-y-auto"><header class="h-16 border-b border-[#30363d] bg-[#0d1117]/50 backdrop-blur-sm flex items-center justify-between px-8 sticky top-0 z-10"><h2 class="text-lg font-semibold text-white">${escape_html(navItems.find((i) => i.path === currentPath())?.name || "Portal")}</h2> <div class="flex items-center gap-6"><div class="flex flex-col items-end"><span class="text-xs text-gray-400">Org Quota Usage</span> <div class="flex items-center gap-2"><div class="w-32 h-1.5 bg-gray-800 rounded-full overflow-hidden"><div class="h-full bg-blue-500 rounded-full"${attr_style(`width: ${stringify(data.org ? (data.org.usedQuota / data.org.totalQuota * 100).toFixed(1) : 0)}%`)}></div></div> <span class="text-xs font-mono">${escape_html(data.org ? (data.org.usedQuota / data.org.totalQuota * 100).toFixed(1) : 0)}%</span></div></div></div></header> <div class="p-8">`);
			children($$renderer);
			$$renderer.push(`<!----></div></main></div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			children($$renderer);
			$$renderer.push(`<!---->`);
		}
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _layout as default };
