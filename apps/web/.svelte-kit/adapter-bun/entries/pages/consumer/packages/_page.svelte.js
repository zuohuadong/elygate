import { N as escape_html, d as sanitize_props, f as slot, p as spread_props } from "../../../../chunks/server.js";
import { t as Icon } from "../../../../chunks/Icon.js";
import { t as i18n } from "../../../../chunks/index.svelte.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/box.svelte
function Box($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "box" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" }],
				["path", { "d": "m3.3 7 8.7 5 8.7-5" }],
				["path", { "d": "M12 22V12" }]
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
//#region src/routes/consumer/packages/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<div class="flex-1 space-y-8 text-left max-w-5xl mx-auto w-full"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Box($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "我的订阅" : "My Subscriptions")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "查看您已购买的模型授权套餐及过期时间。支持在套餐有效期内无限次或依套餐限制调用覆盖的模型。" : "View your active model access packages and their expiration dates.")}</p></div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
export { _page as default };
