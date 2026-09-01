import "../../../chunks/index-server.js";
import { N as escape_html, a as derived, j as attr } from "../../../chunks/server.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Shield_alert } from "../../../chunks/shield-alert.js";
import { t as X } from "../../../chunks/x.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
//#region src/components/RateLimitModal.svelte
function RateLimitModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show, rateLimit = null, onClose, onSave } = $$props;
		let formData = {
			name: "",
			rpm: 0,
			rph: 0,
			concurrent: 0
		};
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0"><div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" role="button" aria-label="Close modal" tabindex="-1"></div> <div class="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden ring-1 ring-slate-200 dark:ring-slate-800 animate-in fade-in zoom-in-95 duration-200" role="dialog" aria-modal="true"><div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50"><h3 class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">`);
			Shield_alert($$renderer, { class: "w-5 h-5 text-indigo-500" });
			$$renderer.push(`<!----> ${escape_html(rateLimit ? i18n.lang === "zh" ? "编辑限流规则" : "Edit Rate Limit" : i18n.lang === "zh" ? "新建限流规则" : "New Rate Limit")}</h3> <button class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <form class="p-6 space-y-5"><div class="space-y-4"><div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escape_html(i18n.lang === "zh" ? "规则名称" : "Rule Name")} <span class="text-rose-500">*</span></label> <input type="text"${attr("value", formData.name)} required="" placeholder="e.g. GPT-4 Limited" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors placeholder:text-slate-400"/></div> <div class="grid grid-cols-2 gap-4"><div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">RPM <span class="text-xs text-slate-400">(${escape_html(i18n.lang === "zh" ? "次/分钟" : "req/min")})</span></label> <input type="number" min="0"${attr("value", formData.rpm)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"/></div> <div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">RPH <span class="text-xs text-slate-400">(${escape_html(i18n.lang === "zh" ? "次/小时" : "req/hour")})</span></label> <input type="number" min="0"${attr("value", formData.rph)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"/></div></div> <div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escape_html(i18n.lang === "zh" ? "并发限制" : "Concurrent Limit")} <span class="text-xs text-slate-400">(${escape_html(i18n.lang === "zh" ? "0为无限制" : "0=unlimited")})</span></label> <input type="number" min="0"${attr("value", formData.concurrent)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"/></div></div> <div class="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800"><button type="button" class="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm focus:ring-2 focus:ring-slate-500/20">${escape_html(i18n.t.common?.cancel || "Cancel")}</button> <button type="submit" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900">${escape_html(i18n.t.common?.save || "Save")}</button></div></form></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/routes/rate-limits/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let rules = [];
		let isLoading = true;
		let errorMsg = "";
		let isModalOpen = false;
		let selectedRule = null;
		async function loadRules() {
			isLoading = true;
			try {
				rules = await apiFetch("/admin/rate-limits");
			} catch (err) {
				errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : "Failed to load rate limits";
			} finally {
				isLoading = false;
			}
		}
		let columns = derived(() => [
			{
				key: "id",
				label: "ID"
			},
			{
				key: "name",
				label: i18n.lang === "zh" ? "规则名称" : "Rule Name"
			},
			{
				key: "rpm",
				label: "RPM"
			},
			{
				key: "rph",
				label: "RPH"
			},
			{
				key: "concurrent",
				label: i18n.lang === "zh" ? "并发上限" : "Concurrent Limit"
			}
		]);
		function handleEdit(rule) {
			selectedRule = rule;
			isModalOpen = true;
		}
		async function handleDelete(rule) {
			if (!confirm(i18n.lang === "zh" ? `确认删除限流规则 "${rule.name}" 吗？这可能导致正在使用此规则的套餐报错。` : `Delete rule "${rule.name}"?`)) return;
			try {
				await apiFetch(`/admin/rate-limits/${rule.id}`, { method: "DELETE" });
				await loadRules();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSave(data) {
			try {
				if (selectedRule) await apiFetch(`/admin/rate-limits/${selectedRule.id}`, {
					method: "PUT",
					body: JSON.stringify(data)
				});
				else await apiFetch("/admin/rate-limits", {
					method: "POST",
					body: JSON.stringify(data)
				});
				isModalOpen = false;
				await loadRules();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Shield_alert($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "限流规则" : "Rate Limits")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "配置全局或套餐专属的多维请求频率控制器。" : "Configure global or package-specific frequency controllers.")}</p></div> <div class="flex gap-3"><button class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">${escape_html(i18n.lang === "zh" ? "刷新列表" : "Refresh")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "新增规则" : "Add Rule")}</button></div></div> `);
		if (isLoading) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		} else if (errorMsg) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">${escape_html(i18n.t.common.failed)}: ${escape_html(errorMsg)}</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			DataTable($$renderer, {
				data: rules,
				columns: columns(),
				onEdit: handleEdit,
				onDelete: handleDelete
			});
		}
		$$renderer.push(`<!--]--></div> `);
		RateLimitModal($$renderer, {
			show: isModalOpen,
			rateLimit: selectedRule,
			onClose: () => isModalOpen = false,
			onSave: handleSave
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _page as default };
