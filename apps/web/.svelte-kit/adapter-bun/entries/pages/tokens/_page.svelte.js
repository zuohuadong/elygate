import "../../../chunks/index-server.js";
import { N as escape_html, a as derived, j as attr, m as stringify, t as attr_class } from "../../../chunks/server.js";
import { t as Key_round } from "../../../chunks/key-round.js";
import { t as Key } from "../../../chunks/key.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Refresh_cw } from "../../../chunks/refresh-cw.js";
import { t as Save } from "../../../chunks/save.js";
import { t as Search } from "../../../chunks/search.js";
import { t as X } from "../../../chunks/x.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
import { t as CopyButton } from "../../../chunks/CopyButton.js";
//#region src/components/TokenModal.svelte
function TokenModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show = false, token = null, onClose = () => {}, onSave = (data) => {} } = $$props;
		let formData = {
			name: "",
			remainQuota: 1e6,
			expiredAt: -1,
			status: 1
		};
		let isSubmitting = false;
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" tabindex="-1"><div class="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"><div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"><h3 class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">`);
			Key($$renderer, { class: "w-5 h-5 text-indigo-500" });
			$$renderer.push(`<!----> ${escape_html(token ? i18n.t.common.edit : i18n.t.tokens.add)}</h3> <button class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <div class="px-6 py-6 space-y-4 text-left">`);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <div class="space-y-1.5"><label for="tk-name" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.tokens.name)}</label> <input id="tk-name"${attr("value", formData.name)}${attr("placeholder", i18n.t.tokens.namePlaceholder)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="tk-quota" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.tokens.quota)} ${escape_html(i18n.t.tokens.quotaUnit)}</label> <div class="relative"><span class="absolute left-3 top-2 text-slate-400 text-sm">$</span> <input id="tk-quota" type="number"${attr("value", formData.remainQuota)} class="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/> <div class="mt-1 flex gap-2"><button class="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">${escape_html(i18n.t.tokens.unlimited)}</button> <button class="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">+ $1000</button></div></div></div> <div class="space-y-1.5"><label for="tk-expire" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.tokens.expiredAt)} ${escape_html(i18n.t.tokens.expiredAtTip)}</label> <input id="tk-expire" type="number"${attr("value", formData.expiredAt)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="tk-status" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.tokens.status)}</label> `);
			$$renderer.select({
				id: "tk-status",
				value: formData.status,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: 1 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.tokens.active)}`);
				});
				$$renderer.option({ value: 2 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.tokens.banned)}`);
				});
			});
			$$renderer.push(`</div></div> <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50"><button class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">${escape_html(i18n.t.common.cancel)}</button> <button${attr("disabled", isSubmitting, true)} class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors">`);
			$$renderer.push("<!--[-1-->");
			Save($$renderer, { class: "w-4 h-4" });
			$$renderer.push(`<!--]--> ${escape_html(i18n.t.common.save)}</button></div></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/routes/tokens/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let tokens = [];
		let isLoading = true;
		let errorMsg = "";
		let searchQuery = "";
		let isAdmin = derived(() => session.role >= 10);
		let isModalOpen = false;
		let selectedToken = null;
		async function loadTokens() {
			isLoading = true;
			try {
				tokens = (await apiFetch(isAdmin() ? "/admin/tokens" : "/user/tokens")).map((t) => {
					const remainQuota = t.remainQuota !== void 0 ? t.remainQuota : t.remain_quota;
					const usedQuota = (t.usedQuota !== void 0 ? t.usedQuota : t.used_quota) || 0;
					const createdAt = t.createdAt || t.created_at;
					return {
						...t,
						remainQuota,
						usedQuota,
						createdAt,
						dt_status: t.status === 1 ? i18n.lang === "zh" ? "正常" : "Active" : i18n.lang === "zh" ? "禁用" : "Banned",
						dt_created_at: createdAt ? new Date(createdAt).toLocaleString() : "-",
						dt_remain_quota: remainQuota === -1 ? i18n.t.tokens.unlimited : `$ ${(Number(remainQuota || 0) / session.quotaPerUnit).toFixed(4)}`,
						dt_used_quota: `$ ${(Number(usedQuota || 0) / session.quotaPerUnit).toFixed(4)}`
					};
				});
			} catch (err) {
				errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : i18n.lang === "zh" ? "加载令牌失败" : "Failed to load tokens";
			} finally {
				isLoading = false;
			}
		}
		let filteredTokens = derived(() => tokens.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.key.toLowerCase().includes(searchQuery.toLowerCase())));
		let columns = derived(() => [
			{
				key: "name",
				label: i18n.t.tokens.name
			},
			...isAdmin() ? [{
				key: "creatorName",
				label: i18n.lang === "zh" ? "创建者" : "Creator"
			}] : [],
			{
				key: "key",
				label: i18n.t.tokens.key
			},
			{
				key: "dt_remain_quota",
				label: i18n.t.tokens.quota
			},
			{
				key: "dt_used_quota",
				label: i18n.t.tokens.used
			},
			{
				key: "dt_status",
				label: i18n.t.tokens.status
			},
			{
				key: "dt_created_at",
				label: i18n.t.tokens.createdAt
			}
		]);
		function handleEdit(token) {
			selectedToken = token;
			isModalOpen = true;
		}
		async function handleDelete(token) {
			const confirmMsg = i18n.t.common.confirmDelete.replace("{name}", `"${token.name}"`);
			if (!confirm(confirmMsg)) return;
			try {
				await apiFetch(isAdmin() ? `/admin/tokens/${token.id}` : `/user/tokens/${token.id}`, { method: "DELETE" });
				await loadTokens();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSave(data) {
			try {
				if (selectedToken) await apiFetch(isAdmin() ? `/admin/tokens/${selectedToken.id}` : `/user/tokens/${selectedToken.id}`, {
					method: "PUT",
					body: JSON.stringify(data)
				});
				else await apiFetch(isAdmin() ? "/admin/tokens" : "/user/tokens", {
					method: "POST",
					body: JSON.stringify(data)
				});
				isModalOpen = false;
				await loadTokens();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Key_round($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.tokens.title)}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "向用户分发的下级鉴权令牌，支持额度限制和并发控制。" : "Issue API keys to users with quota limits and concurrency control.")}</p></div> <div class="flex gap-3"><div class="relative w-64">`);
		Search($$renderer, { class: "absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" });
		$$renderer.push(`<!----> <input type="text"${attr("value", searchQuery)}${attr("placeholder", i18n.lang === "zh" ? "搜索名称或 Key..." : "Search name or key...")} class="pl-9 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"/></div> <button class="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Refresh">`);
		Refresh_cw($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----></button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.tokens.add)}</button></div></div> `);
		if (isLoading) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		} else if (errorMsg) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">${escape_html(i18n.t.common.failed)}: ${escape_html(errorMsg)}</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			{
				function cell($$renderer, key, value, row) {
					if (key === "key") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<div class="flex items-center gap-2"><span class="font-mono text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 select-all cursor-pointer">${escape_html(value)}</span> `);
						CopyButton($$renderer, { value });
						$$renderer.push(`<!----></div>`);
					} else if (key === "dt_status") {
						$$renderer.push("<!--[1-->");
						const isActive = value === "正常" || value === "Active";
						$$renderer.push(`<span${attr_class(`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stringify(isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400")}`)}><span${attr_class(`w-1.5 h-1.5 ${stringify(isActive ? "bg-emerald-500" : "bg-rose-500")} rounded-full mr-1.5`)}></span> ${escape_html(value)}</span>`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`${escape_html(value)}`);
					}
					$$renderer.push(`<!--]-->`);
				}
				DataTable($$renderer, {
					data: filteredTokens(),
					columns: columns(),
					onEdit: handleEdit,
					onDelete: handleDelete,
					cell,
					$$slots: { cell: true }
				});
			}
		}
		$$renderer.push(`<!--]--></div> `);
		TokenModal($$renderer, {
			show: isModalOpen,
			token: selectedToken,
			onClose: () => isModalOpen = false,
			onSave: handleSave
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _page as default };
