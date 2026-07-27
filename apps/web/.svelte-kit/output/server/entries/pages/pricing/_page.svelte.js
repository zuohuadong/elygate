import { N as escape_html, a as derived, c as head, d as sanitize_props, f as slot, j as attr, m as stringify, p as spread_props, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Refresh_cw } from "../../../chunks/refresh-cw.js";
import { t as Save } from "../../../chunks/save.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/settings-2.svelte
function Settings_2($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "settings-2" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M14 17H5" }],
				["path", { "d": "M19 7h-9" }],
				["circle", {
					"cx": "17",
					"cy": "17",
					"r": "3"
				}],
				["circle", {
					"cx": "7",
					"cy": "7",
					"r": "3"
				}]
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/table.svelte
function Table($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "table" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M12 3v18" }],
				["rect", {
					"width": "18",
					"height": "18",
					"x": "3",
					"y": "3",
					"rx": "2"
				}],
				["path", { "d": "M3 9h18" }],
				["path", { "d": "M3 15h18" }]
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
//#region src/routes/pricing/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let isLoading = true;
		let isAdmin = derived(() => session.role >= 10);
		let activeTab = "list";
		let configs = {
			ModelRatio: "{\n  \"gpt-3.5-turbo\": 1,\n  \"gpt-4\": 15\n}",
			CompletionRatio: "{\n  \"gpt-3.5-turbo\": 1.33,\n  \"gpt-4\": 2\n}",
			GroupRatio: "{\n  \"default\": 1,\n  \"vip\": 0.8\n}",
			GroupModelRatio: "{\n  \"vip\": {\n    \"gpt-4\": 0.5\n  }\n}",
			FixedCostModels: "{\n  \"dall-e-3\": 100000,\n  \"mj-imagine\": 200000\n}"
		};
		const configDefinitions = [
			{
				key: "ModelRatio",
				title: i18n.t.pricing.modelRatio,
				desc: i18n.t.pricing.modelRatioDesc
			},
			{
				key: "CompletionRatio",
				title: i18n.t.pricing.completionRatio,
				desc: i18n.t.pricing.completionRatioDesc
			},
			{
				key: "GroupRatio",
				title: i18n.t.pricing.groupRatio,
				desc: i18n.t.pricing.groupRatioDesc
			},
			{
				key: "GroupModelRatio",
				title: i18n.t.pricing.groupModelRatio,
				desc: i18n.t.pricing.groupModelRatioDesc
			},
			{
				key: "FixedCostModels",
				title: i18n.t.pricing.fixedCostModels,
				desc: i18n.t.pricing.fixedCostModelsDesc
			}
		];
		derived(() => {
			try {
				const mRatios = JSON.parse(configs.ModelRatio);
				const cRatios = JSON.parse(configs.CompletionRatio);
				const fModels = JSON.parse(configs.FixedCostModels);
				const list = [];
				Object.keys(mRatios).forEach((model) => {
					const ratio = mRatios[model];
					const compRatio = cRatios[model] || 1;
					list.push({
						model,
						type: "Chat / Text",
						inputPrice: ratio.toFixed(2),
						outputPrice: (ratio * compRatio).toFixed(2),
						fixedPrice: "-"
					});
				});
				Object.keys(fModels).forEach((model) => {
					const cost = fModels[model];
					list.push({
						model,
						type: "Fixed / Image",
						inputPrice: "-",
						outputPrice: "-",
						fixedPrice: `$ ${(cost / 1e6).toFixed(4)}`
					});
				});
				return list;
			} catch (e) {
				return [];
			}
		});
		head("1hrotn9", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>${escape_html(i18n.t.nav.pricing)} - Elygate</title>`);
			});
		});
		$$renderer.push(`<div class="h-full max-w-6xl mx-auto space-y-6"><div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div><h1 class="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">`);
		Table($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.nav.pricing)}</h1> <p class="text-slate-500 dark:text-slate-400 mt-1">${escape_html(activeTab === "list" ? i18n.t.pricing.desc : i18n.t.pricing.configDesc)}</p></div> <div class="flex items-center gap-3"><div class="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex"><button${attr_class(`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${stringify(activeTab === "list" ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}`)}>${escape_html(i18n.t.pricing.listTab)}</button> `);
		if (isAdmin()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<button${attr_class(`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${stringify(activeTab === "config" ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}`)}>${escape_html(i18n.t.pricing.configTab)}</button>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div> <button class="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800 rounded-lg transition-colors" title="Refresh">`);
		Refresh_cw($$renderer, { class: `w-5 h-5 ${stringify("animate-spin")}` });
		$$renderer.push(`<!----></button> `);
		if (isAdmin() && activeTab === "config") {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<button${attr("disabled", isLoading, true)} class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg shadow-sm transition-colors">`);
			$$renderer.push("<!--[-1-->");
			Save($$renderer, { class: "w-4 h-4" });
			$$renderer.push(`<!--]--> ${escape_html(i18n.t.common.save)}</button>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (activeTab === "list") {
			$$renderer.push("<!--[0-->");
			{
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left border-collapse"><thead><tr class="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800"><th class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">${escape_html(i18n.t.pricing.tableModel)}</th><th class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">${escape_html(i18n.t.pricing.tableType)}</th><th class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">${escape_html(i18n.lang === "zh" ? "输入 (每百万Token)" : "Input (per 1M)")}</th><th class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">${escape_html(i18n.lang === "zh" ? "输出 (每百万Token)" : "Output (per 1M)")}</th><th class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">${escape_html(i18n.t.pricing.tableFixed)}</th></tr></thead><tbody class="divide-y divide-slate-100 dark:divide-slate-800"><!--[-->`);
				const each_array = ensure_array_like(Array(8));
				for (let i = 0, $$length = each_array.length; i < $$length; i++) {
					each_array[i];
					$$renderer.push(`<tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"><td class="px-6 py-4"><div class="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div></td><td class="px-6 py-4"><div class="h-5 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div></td><td class="px-6 py-4"><div class="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div></td><td class="px-6 py-4"><div class="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div></td><td class="px-6 py-4"><div class="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div></td></tr>`);
				}
				$$renderer.push(`<!--]--></tbody></table></div></div>`);
			}
			$$renderer.push(`<!--]-->`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="grid grid-cols-1 md:grid-cols-2 gap-6"><!--[-->`);
			const each_array_2 = ensure_array_like(configDefinitions);
			for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
				let def = each_array_2[$$index_2];
				$$renderer.push(`<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col"><div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50"><div class="flex items-center justify-between"><h2 class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">`);
				Settings_2($$renderer, { class: "w-4 h-4 text-slate-400" });
				$$renderer.push(`<!----> ${escape_html(def.title)}</h2></div> <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">${escape_html(def.desc)}</p></div> <div class="p-1 flex-1 bg-slate-100 dark:bg-slate-950"><textarea class="w-full h-48 md:h-64 p-4 font-mono text-sm bg-transparent outline-none resize-none text-slate-800 dark:text-slate-200 placeholder:text-slate-400" spellcheck="false">`);
				const $$body = escape_html(configs[def.key]);
				if ($$body) $$renderer.push(`${$$body}`);
				$$renderer.push(`</textarea></div></div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
export { _page as default };
