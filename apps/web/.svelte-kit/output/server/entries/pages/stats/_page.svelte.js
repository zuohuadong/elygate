import { N as escape_html, j as attr } from "../../../chunks/server.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import "../../../chunks/session.js";
//#region src/routes/stats/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<div class="container mx-auto p-6"><div class="mb-8 flex items-center justify-between"><div><h1 class="text-3xl font-bold text-gray-900 dark:text-white">${escape_html(i18n.lang === "zh" ? "数据统计" : "Statistics Dashboard")}</h1> <p class="text-gray-600 dark:text-gray-400 mt-2">${escape_html(i18n.lang === "zh" ? "实时监控系统运行状态" : "Real-time monitoring of system status")}</p></div> <div class="flex items-center gap-4"><label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><input type="checkbox"${attr("checked", true, true)} class="rounded"/> ${escape_html(i18n.lang === "zh" ? "自动刷新" : "Auto Refresh")}</label> <button${attr("disabled", true, true)} class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">${escape_html(i18n.lang === "zh" ? "刷新中..." : "Refreshing...")}</button></div></div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="flex items-center justify-center py-20"><div class="text-center"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div> <p class="text-gray-600 dark:text-gray-400">${escape_html(i18n.lang === "zh" ? "加载中..." : "Loading...")}</p></div></div>`);
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
export { _page as default };
