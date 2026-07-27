import { N as escape_html } from "../../../../chunks/server.js";
import { t as History } from "../../../../chunks/history.js";
import { t as i18n } from "../../../../chunks/index.svelte.js";
import "../../../../chunks/session.js";
import "../../../../chunks/DataTable.js";
//#region src/routes/consumer/logs/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		i18n.lang, i18n.lang, i18n.lang, i18n.lang, i18n.lang;
		$$renderer.push(`<div class="flex-1 space-y-6 max-w-5xl mx-auto p-4 md:p-0"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		History($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "我的接口日志" : "My API Logs")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "查看您的历史大模型调用与消耗明细" : "View your historical model inference usage and cost records.")}</p></div></div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
export { _page as default };
