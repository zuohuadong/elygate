import { N as escape_html, a as derived, m as stringify, t as attr_class } from "../../../chunks/server.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Ticket } from "../../../chunks/ticket.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
import { t as CopyButton } from "../../../chunks/CopyButton.js";
//#region src/routes/invite-codes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let inviteCodes = [];
		let isLoading = true;
		let errorMsg = "";
		let page = 1;
		let limit = 50;
		async function loadData() {
			isLoading = true;
			try {
				const data = await apiFetch(`/admin/invite-codes?page=${page}&limit=${limit}`);
				inviteCodes = data.data.map((c) => {
					const giftQuota = c.giftQuota || 0;
					return {
						...c,
						displayStatus: getStatusText(c.status, c.usedCount, c.maxUses, c.expiresAt),
						formattedQuota: session.formatQuota(Number(giftQuota)),
						usageStr: `${c.usedCount || 0} / ${c.maxUses || 0}`,
						formattedExpires: c.expiresAt ? new Date(c.expiresAt).toLocaleString() : "-"
					};
				});
				data.total;
			} catch (err) {
				errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : i18n.lang === "zh" ? "加载邀请码失败" : "Failed to load invite codes";
			} finally {
				isLoading = false;
			}
		}
		function getStatusText(status, usedCount, maxUses, expiresAt) {
			if (status !== 1) return i18n.lang === "zh" ? "已禁用" : "Disabled";
			if (usedCount >= maxUses) return i18n.lang === "zh" ? "已用完" : "Exhausted";
			if (expiresAt && new Date(expiresAt) < /* @__PURE__ */ new Date()) return i18n.lang === "zh" ? "已过期" : "Expired";
			return i18n.lang === "zh" ? "有效" : "Active";
		}
		let columns = derived(() => [
			{
				key: "id",
				label: "ID"
			},
			{
				key: "code",
				label: i18n.lang === "zh" ? "邀请码" : "Code"
			},
			{
				key: "usageStr",
				label: i18n.lang === "zh" ? "使用次数" : "Usage"
			},
			{
				key: "formattedQuota",
				label: i18n.lang === "zh" ? "赠送额度" : "Gift Quota"
			},
			{
				key: "formattedExpires",
				label: i18n.lang === "zh" ? "过期时间" : "Expires"
			},
			{
				key: "creatorName",
				label: i18n.lang === "zh" ? "创建者" : "Creator"
			},
			{
				key: "displayStatus",
				label: i18n.t.tokens.status
			}
		]);
		async function handleDelete(item) {
			if (!confirm(i18n.lang === "zh" ? `确定要删除邀请码 "${item.code}" 吗？` : `Are you sure you want to delete invite code "${item.code}"?`)) return;
			try {
				await apiFetch(`/admin/invite-codes/${item.id}`, { method: "DELETE" });
				await loadData();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Ticket($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "邀请码管理" : "Invite Codes")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "管理和生成注册邀请码" : "Manage and generate registration invite codes")}</p></div> <div class="flex gap-3"><button class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">${escape_html(i18n.lang === "zh" ? "刷新列表" : "Refresh")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "生成邀请码" : "Generate")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "批量生成" : "Batch Generate")}</button></div></div> `);
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
					if (key === "code") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<div class="flex items-center gap-2"><code class="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">${escape_html(value)}</code> `);
						CopyButton($$renderer, { value });
						$$renderer.push(`<!----></div>`);
					} else if (key === "displayStatus") {
						$$renderer.push("<!--[1-->");
						const isActive = value === (i18n.lang === "zh" ? "有效" : "Active");
						const isAmber = value === (i18n.lang === "zh" ? "已用完" : "Exhausted") || value === (i18n.lang === "zh" ? "已过期" : "Expired");
						const isRose = value === (i18n.lang === "zh" ? "已禁用" : "Disabled");
						$$renderer.push(`<span${attr_class(`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stringify(isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" : isAmber ? "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400" : isRose ? "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400" : "bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400")}`)}>${escape_html(value)}</span>`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`${escape_html(value)}`);
					}
					$$renderer.push(`<!--]-->`);
				}
				function customActions($$renderer, row) {
					$$renderer.push(`<button class="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors mr-2 opacity-0 group-hover:opacity-100">${escape_html(row.status === 1 ? i18n.lang === "zh" ? "禁用" : "Disable" : i18n.lang === "zh" ? "启用" : "Enable")}</button>`);
				}
				DataTable($$renderer, {
					data: inviteCodes,
					columns: columns(),
					onDelete: handleDelete,
					cell,
					customActions,
					$$slots: {
						cell: true,
						customActions: true
					}
				});
			}
		}
		$$renderer.push(`<!--]--></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _page as default };
