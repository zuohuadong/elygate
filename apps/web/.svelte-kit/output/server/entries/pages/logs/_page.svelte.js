import { N as escape_html, d as sanitize_props, f as slot, j as attr, m as stringify, n as attr_style, p as spread_props, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Funnel } from "../../../chunks/funnel.js";
import { t as Search } from "../../../chunks/search.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import "../../../chunks/session.js";
import "../../../chunks/DataTable.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/download.svelte
function Download($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "download" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M12 15V3" }],
				["path", { "d": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
				["path", { "d": "m7 10 5 5 5-5" }]
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/house.svelte
function House($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "house" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }], ["path", { "d": "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }]],
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
//#region src/components/Skeleton.svelte
function Skeleton($$renderer, $$props) {
	let { width = "100%", height = "1rem", rounded = "md", class: className = "" } = $$props;
	$$renderer.push(`<div${attr_class(`animate-pulse bg-slate-200 dark:bg-slate-800 ${stringify({
		"none": "rounded-none",
		"sm": "rounded-sm",
		"md": "rounded-md",
		"lg": "rounded-lg",
		"xl": "rounded-xl",
		"full": "rounded-full"
	}[rounded] || "rounded-md")} ${stringify(className)}`)}${attr_style(`width: ${stringify(width)}; height: ${stringify(height)};`)}></div>`);
}
//#endregion
//#region src/components/DataTableSkeleton.svelte
function DataTableSkeleton($$renderer, $$props) {
	let { rows = 5, columns = 4 } = $$props;
	$$renderer.push(`<div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"><div class="flex items-center gap-4 px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800"><!--[-->`);
	const each_array = ensure_array_like(Array(columns));
	for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
		each_array[$$index];
		$$renderer.push(`<div class="flex-1">`);
		Skeleton($$renderer, {
			height: "0.875rem",
			width: "60%"
		});
		$$renderer.push(`<!----></div>`);
	}
	$$renderer.push(`<!--]--></div> <!--[-->`);
	const each_array_1 = ensure_array_like(Array(rows));
	for (let $$index_2 = 0, $$length = each_array_1.length; $$index_2 < $$length; $$index_2++) {
		each_array_1[$$index_2];
		$$renderer.push(`<div class="flex items-center gap-4 px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0"><!--[-->`);
		const each_array_2 = ensure_array_like(Array(columns));
		for (let $$index_1 = 0, $$length = each_array_2.length; $$index_1 < $$length; $$index_1++) {
			each_array_2[$$index_1];
			$$renderer.push(`<div class="flex-1">`);
			Skeleton($$renderer, {
				height: "1rem",
				width: "80%"
			});
			$$renderer.push(`<!----></div>`);
		}
		$$renderer.push(`<!--]--></div>`);
	}
	$$renderer.push(`<!--]--></div>`);
}
//#endregion
//#region src/routes/logs/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let isExporting = false;
		i18n.lang, i18n.lang, i18n.lang, i18n.lang, i18n.lang, i18n.lang, i18n.lang, i18n.lang, i18n.lang;
		$$renderer.push(`<div class="flex-1 space-y-6 w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		House($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> 日志审核</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">全平台明细流水查询，包含消耗、上游耗时及流式状态记录。</p></div> <div class="flex gap-3"><div class="relative w-72">`);
		Search($$renderer, { class: "absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" });
		$$renderer.push(`<!----> <input type="text" placeholder="按模型、用户或渠道搜索..." class="pl-9 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"/></div> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">`);
		Funnel($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> 高级筛选</button> <div class="relative"><button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"${attr("disabled", isExporting, true)}>`);
		Download($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html("Export")}</button> <div id="export-dropdown" class="hidden absolute right-0 mt-2 w-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg z-10"><button class="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-t-lg">Export as CSV</button> <button class="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-b-lg">Export as JSON</button></div></div></div></div> `);
		$$renderer.push("<!--[0-->");
		DataTableSkeleton($$renderer, {
			rows: 8,
			columns: 8
		});
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
export { _page as default };
