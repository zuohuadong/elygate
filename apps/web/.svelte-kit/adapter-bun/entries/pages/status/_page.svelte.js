import { N as escape_html, d as sanitize_props, f as slot, p as spread_props, s as ensure_array_like } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Activity } from "../../../chunks/activity.js";
import { t as Circle_check } from "../../../chunks/circle-check.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/triangle-alert.svelte
function Triangle_alert($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "triangle-alert" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
				["path", { "d": "M12 9v4" }],
				["path", { "d": "M12 17h.01" }]
			],
			children: ($$renderer) => {
				$$renderer.push(`<!--[-->`);
				slot($$renderer, $$props, "default", {}, null);
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}
	]));
}
//#endregion
//#region src/routes/status/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let channels = [];
		let lastUpdated = /* @__PURE__ */ new Date();
		$$renderer.push(`<div class="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12"><div class="max-w-4xl mx-auto space-y-8"><div class="flex flex-col md:flex-row md:items-end justify-between gap-4"><div class="space-y-2"><div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-500 text-xs font-bold uppercase tracking-wider">`);
		Activity($$renderer, { size: 14 });
		$$renderer.push(`<!----> System Status</div> <h1 class="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Channel Health</h1> <p class="text-slate-500 dark:text-slate-400">Real-time status of all upstream API channels.</p></div> <div class="text-xs text-slate-400 font-mono">Last updated: ${escape_html(lastUpdated.toLocaleTimeString())}</div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm overflow-hidden relative"><div class="flex items-center gap-4 relative z-10">`);
		if (channels.every((c) => c.status === 1)) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500">`);
			Circle_check($$renderer, { size: 32 });
			$$renderer.push(`<!----></div> <div><h2 class="text-lg font-bold text-slate-900 dark:text-white">All Systems Operational</h2> <p class="text-sm text-slate-500">Elygate is performing at optimal capacity.</p></div>`);
		} else if (channels.some((c) => c.status === 1)) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">`);
			Triangle_alert($$renderer, { size: 32 });
			$$renderer.push(`<!----></div> <div><h2 class="text-lg font-bold text-slate-900 dark:text-white">Partial Outage</h2> <p class="text-sm text-slate-500">Some channels are experiencing issues or rate limiting.</p></div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-500">`);
			Triangle_alert($$renderer, { size: 32 });
			$$renderer.push(`<!----></div> <div><h2 class="text-lg font-bold text-slate-900 dark:text-white">Major Service Outage</h2> <p class="text-sm text-slate-500">Most channels are currently down. Check back soon.</p></div>`);
		}
		$$renderer.push(`<!--]--></div> <div class="absolute -right-4 -bottom-4 opacity-5 pointer-events-none">`);
		Activity($$renderer, { size: 160 });
		$$renderer.push(`<!----></div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm"><div class="divide-y divide-slate-100 dark:divide-slate-800/50">`);
		{
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<!--[-->`);
			const each_array = ensure_array_like(Array(5));
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				each_array[$$index];
				$$renderer.push(`<div class="p-6 flex items-center justify-between animate-pulse"><div class="h-6 w-32 bg-slate-100 dark:bg-slate-800 rounded-md"></div> <div class="h-6 w-24 bg-slate-100 dark:bg-slate-800 rounded-full"></div></div>`);
			}
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></div></div> <div class="text-center space-y-4 pt-4"><p class="text-sm text-slate-400">Elygate uses an intelligent circuit breaker system to automatically failover and recover channels.</p> <div class="flex justify-center gap-6"><a href="/" class="text-xs text-indigo-500 hover:text-indigo-400 font-medium">Back to Home</a> <a href="https://github.com/zuohuadong/elygate" target="_blank" class="text-xs text-slate-500 hover:text-slate-400 font-medium">GitHub</a></div></div></div></div>`);
	});
}
//#endregion
export { _page as default };
