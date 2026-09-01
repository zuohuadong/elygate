import { N as escape_html, d as sanitize_props, f as slot, j as attr, m as stringify, p as spread_props, s as ensure_array_like, t as attr_class } from "../../../../chunks/server.js";
import { t as Icon } from "../../../../chunks/Icon.js";
import { t as Dollar_sign } from "../../../../chunks/dollar-sign.js";
import { t as Zap } from "../../../../chunks/zap.js";
import { t as i18n } from "../../../../chunks/index.svelte.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/info.svelte
function Info($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "info" },
		sanitize_props($$props),
		{
			iconNode: [
				["circle", {
					"cx": "12",
					"cy": "12",
					"r": "10"
				}],
				["path", { "d": "M12 16v-4" }],
				["path", { "d": "M12 8h.01" }]
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
//#region src/routes/consumer/pricing/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let searchQuery = "";
		let selectedCategory = "all";
		const categories = [
			{
				id: "all",
				label: "全部",
				labelEn: "All"
			},
			{
				id: "GPT",
				label: "GPT",
				labelEn: "GPT"
			},
			{
				id: "Claude",
				label: "Claude",
				labelEn: "Claude"
			},
			{
				id: "Gemini",
				label: "Gemini",
				labelEn: "Gemini"
			},
			{
				id: "Qwen",
				label: "Qwen",
				labelEn: "Qwen"
			},
			{
				id: "DeepSeek",
				label: "DeepSeek",
				labelEn: "DeepSeek"
			}
		];
		$$renderer.push(`<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full"><div><h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">`);
		Dollar_sign($$renderer, { class: "w-6 h-6 text-emerald-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "模型定价" : "Model Pricing")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "查看各模型的定价信息，价格单位为每百万 tokens" : "View pricing for all models. Prices are per million tokens.")}</p></div> <div class="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 text-white"><div class="flex items-start gap-4"><div class="p-3 bg-white/20 rounded-xl">`);
		Zap($$renderer, { class: "w-6 h-6" });
		$$renderer.push(`<!----></div> <div><h3 class="font-bold text-lg">${escape_html(i18n.lang === "zh" ? "按量计费，灵活高效" : "Pay as you go")}</h3> <p class="text-white/80 text-sm mt-1">${escape_html(i18n.lang === "zh" ? "只需为您实际使用的 tokens 付费，无最低消费要求。支持多种主流模型，价格透明。" : "Only pay for the tokens you actually use. No minimum commitment. Support for multiple mainstream models with transparent pricing.")}</p></div></div></div> <div class="flex flex-col sm:flex-row gap-4"><div class="flex-1"><input type="text"${attr("value", searchQuery)}${attr("placeholder", i18n.lang === "zh" ? "搜索模型..." : "Search models...")} class="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div> <div class="flex gap-2 overflow-x-auto pb-2 sm:pb-0"><!--[-->`);
		const each_array = ensure_array_like(categories);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let category = each_array[$$index];
			$$renderer.push(`<button${attr_class(`px-4 py-2 text-sm font-medium rounded-xl whitespace-nowrap transition ${stringify(selectedCategory === category.id ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-indigo-300")}`)}>${escape_html(i18n.lang === "zh" ? category.label : category.labelEn)}</button>`);
		}
		$$renderer.push(`<!--]--></div></div> <div class="space-y-4">`);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		$$renderer.push(`<!--]--></div> <div class="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">`);
		Info($$renderer, { class: "w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" });
		$$renderer.push(`<!----> <div class="text-sm text-amber-800 dark:text-amber-200">${escape_html(i18n.lang === "zh" ? "以上价格仅供参考，实际价格以系统配置为准。不同渠道可能有不同的定价策略。" : "Prices shown are for reference only. Actual prices may vary based on system configuration. Different channels may have different pricing strategies.")}</div></div></div>`);
	});
}
//#endregion
export { _page as default };
