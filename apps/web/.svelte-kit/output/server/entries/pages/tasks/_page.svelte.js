import { N as escape_html, d as sanitize_props, f as slot, p as spread_props, s as ensure_array_like } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Circle_x } from "../../../chunks/circle-x.js";
import { t as Clock } from "../../../chunks/clock.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/circle-alert.svelte
function Circle_alert($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "circle-alert" },
		sanitize_props($$props),
		{
			iconNode: [
				["circle", {
					"cx": "12",
					"cy": "12",
					"r": "10"
				}],
				["line", {
					"x1": "12",
					"x2": "12",
					"y1": "8",
					"y2": "12"
				}],
				["line", {
					"x1": "12",
					"x2": "12.01",
					"y1": "16",
					"y2": "16"
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/circle-check-big.svelte
function Circle_check_big($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "circle-check-big" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "M21.801 10A10 10 0 1 1 17 3.335" }], ["path", { "d": "m9 11 3 3L22 4" }]],
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/list-todo.svelte
function List_todo($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "list-todo" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M13 5h8" }],
				["path", { "d": "M13 12h8" }],
				["path", { "d": "M13 19h8" }],
				["path", { "d": "m3 17 2 2 4-4" }],
				["rect", {
					"x": "3",
					"y": "4",
					"width": "6",
					"height": "6",
					"rx": "1"
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/loader-circle.svelte
function Loader_circle($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "loader-circle" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "M21 12a9 9 0 1 1-6.219-8.56" }]],
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
//#region src/routes/tasks/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let tasks = [];
		let filterStatus = "all";
		let filterType = "all";
		const statusMap = {
			0: {
				label: "等待中",
				labelEn: "Pending",
				color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
				icon: Clock
			},
			1: {
				label: "运行中",
				labelEn: "Running",
				color: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
				icon: Loader_circle
			},
			2: {
				label: "已完成",
				labelEn: "Completed",
				color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
				icon: Circle_check_big
			},
			3: {
				label: "失败",
				labelEn: "Failed",
				color: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
				icon: Circle_x
			},
			4: {
				label: "已取消",
				labelEn: "Cancelled",
				color: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
				icon: Circle_alert
			}
		};
		const typeMap = {
			data_export: {
				label: "数据导出",
				labelEn: "Data Export"
			},
			data_import: {
				label: "数据导入",
				labelEn: "Data Import"
			},
			cache_clear: {
				label: "缓存清理",
				labelEn: "Cache Clear"
			},
			batch_operation: {
				label: "批量操作",
				labelEn: "Batch Operation"
			}
		};
		$$renderer.push(`<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full"><div class="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">`);
		List_todo($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "任务管理" : "Task Management")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "管理异步任务和批量操作" : "Manage async tasks and batch operations")}</p></div></div> <div class="flex flex-wrap gap-4"><div class="flex items-center gap-2"><label class="text-sm text-slate-500">${escape_html(i18n.lang === "zh" ? "状态" : "Status")}:</label> `);
		$$renderer.select({
			value: filterStatus,
			class: "px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm"
		}, ($$renderer) => {
			$$renderer.option({ value: "all" }, ($$renderer) => {
				$$renderer.push(`${escape_html(i18n.lang === "zh" ? "全部" : "All")}`);
			});
			$$renderer.push(`<!--[-->`);
			const each_array = ensure_array_like(Object.entries(statusMap));
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let [key, value] = each_array[$$index];
				$$renderer.option({ value: key }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.lang === "zh" ? value.label : value.labelEn)}`);
				});
			}
			$$renderer.push(`<!--]-->`);
		});
		$$renderer.push(`</div> <div class="flex items-center gap-2"><label class="text-sm text-slate-500">${escape_html(i18n.lang === "zh" ? "类型" : "Type")}:</label> `);
		$$renderer.select({
			value: filterType,
			class: "px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm"
		}, ($$renderer) => {
			$$renderer.option({ value: "all" }, ($$renderer) => {
				$$renderer.push(`${escape_html(i18n.lang === "zh" ? "全部" : "All")}`);
			});
			$$renderer.push(`<!--[-->`);
			const each_array_1 = ensure_array_like(Object.entries(typeMap));
			for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
				let [key, value] = each_array_1[$$index_1];
				$$renderer.option({ value: key }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.lang === "zh" ? value.label : value.labelEn)}`);
				});
			}
			$$renderer.push(`<!--]-->`);
		});
		$$renderer.push(`</div> <button class="px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition">${escape_html(i18n.lang === "zh" ? "刷新" : "Refresh")}</button></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">`);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="flex items-center justify-center py-12">`);
		Loader_circle($$renderer, { class: "w-6 h-6 animate-spin text-indigo-500" });
		$$renderer.push(`<!----></div>`);
		$$renderer.push(`<!--]--></div> <div class="grid grid-cols-2 md:grid-cols-5 gap-4"><!--[-->`);
		const each_array_3 = ensure_array_like(Object.entries(statusMap));
		for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
			let [key, value] = each_array_3[$$index_3];
			$$renderer.push(`<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"><div class="text-2xl font-bold text-slate-900 dark:text-white">${escape_html(tasks.filter((t) => t.status === parseInt(key)).length)}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? value.label : value.labelEn)}</div></div>`);
		}
		$$renderer.push(`<!--]--></div></div>`);
	});
}
//#endregion
export { _page as default };
