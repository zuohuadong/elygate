import "../../../chunks/index-server.js";
import { N as escape_html, a as derived, d as sanitize_props, f as slot, j as attr, m as stringify, p as spread_props, t as attr_class } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Dollar_sign } from "../../../chunks/dollar-sign.js";
import { t as Gift } from "../../../chunks/gift.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Save } from "../../../chunks/save.js";
import { t as X } from "../../../chunks/x.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
import { t as CopyButton } from "../../../chunks/CopyButton.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/calculator.svelte
function Calculator($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "calculator" },
		sanitize_props($$props),
		{
			iconNode: [
				["rect", {
					"width": "16",
					"height": "20",
					"x": "4",
					"y": "2",
					"rx": "2"
				}],
				["line", {
					"x1": "8",
					"x2": "16",
					"y1": "6",
					"y2": "6"
				}],
				["line", {
					"x1": "16",
					"x2": "16",
					"y1": "14",
					"y2": "18"
				}],
				["path", { "d": "M16 10h.01" }],
				["path", { "d": "M12 10h.01" }],
				["path", { "d": "M8 10h.01" }],
				["path", { "d": "M12 14h.01" }],
				["path", { "d": "M8 14h.01" }],
				["path", { "d": "M12 18h.01" }],
				["path", { "d": "M8 18h.01" }]
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/coins.svelte
function Coins($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "coins" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M13.744 17.736a6 6 0 1 1-7.48-7.48" }],
				["path", { "d": "M15 6h1v4" }],
				["path", { "d": "m6.134 14.768.866-.5 2 3.464" }],
				["circle", {
					"cx": "16",
					"cy": "8",
					"r": "6"
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
//#region src/components/RedemptionModal.svelte
function RedemptionModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show = false, redemption = null, onClose = () => {}, onSave = (data) => {} } = $$props;
		let formData = {
			name: "",
			key: "",
			quota: session.quotaPerUnit,
			count: 1,
			status: 1
		};
		let usd = 0;
		let rmb = 0;
		let isSubmitting = false;
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" tabindex="-1"><div class="bg-white dark:bg-slate-950 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"><div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"><h3 class="text-lg font-semibold text-slate-900 dark:text-white">${escape_html(redemption ? i18n.t.common.edit : i18n.t.redemptions.generateCode)}</h3> <button class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <div class="px-6 py-6 max-h-[70vh] overflow-y-auto space-y-4 text-left">`);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <div class="space-y-1.5"><label for="r-name" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.redemptions.nameNote)}</label> <input id="r-name"${attr("value", formData.name)}${attr("placeholder", i18n.t.redemptions.namePlaceholder)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="r-key" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.redemptions.specificKey)}</label> <input id="r-key"${attr("value", formData.key)} placeholder="elygate-xxx"${attr("disabled", !!redemption, true)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:text-slate-400 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-4 pt-2"><div class="space-y-1.5"><label for="r-quota" class="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">`);
			Calculator($$renderer, { class: "w-4 h-4 text-indigo-500" });
			$$renderer.push(`<!----> ${escape_html(i18n.t.redemptions.quotaHelp)}</label> <div class="relative"><input id="r-quota" type="number"${attr("value", formData.quota)} class="w-full pl-3 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/> <div class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase">Qta</div></div></div> <div class="grid grid-cols-2 gap-4"><div class="space-y-1.5"><label for="r-usd" class="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">`);
			Dollar_sign($$renderer, { class: "w-3.5 h-3.5 text-emerald-500" });
			$$renderer.push(`<!----> ${escape_html(i18n.t.redemptions.usdAmount)}</label> <div class="relative"><input id="r-usd" type="number" step="0.01"${attr("value", usd)} class="w-full pl-3 pr-8 py-2 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/> <div class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">USD</div></div></div> <div class="space-y-1.5"><label for="r-rmb" class="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">`);
			Coins($$renderer, { class: "w-3.5 h-3.5 text-amber-500" });
			$$renderer.push(`<!----> ${escape_html(i18n.t.redemptions.rmbAmount)}</label> <div class="relative"><input id="r-rmb" type="number" step="0.01"${attr("value", rmb)} class="w-full pl-3 pr-8 py-2 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/> <div class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">RMB</div></div></div></div> <div class="bg-indigo-50/50 dark:bg-indigo-500/5 rounded-lg p-3 border border-indigo-100/50 dark:border-indigo-500/10"><p class="text-[11px] text-indigo-600 dark:text-indigo-400 leading-relaxed font-medium">${escape_html(i18n.t.redemptions.conversionNotice.replace("{rate}", session.exchangeRate.toString()))} <br/> 1 USD = ${escape_html(session.quotaPerUnit.toLocaleString())} Quota</p></div> <div class="space-y-1.5 pt-2"><label for="r-uses" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.redemptions.maxUses)}</label> <input id="r-uses" type="number"${attr("value", formData.count)}${attr("disabled", !!redemption && redemption.used_count > 0, true)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div></div> <div class="space-y-1.5 pt-2"><label for="rd-status" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.redemptions.status)}</label> `);
			$$renderer.select({
				id: "rd-status",
				value: formData.status,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: 1 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.redemptions.active)}`);
				});
				$$renderer.option({ value: 2 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.redemptions.disabled)}`);
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
//#region src/routes/redemptions/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let redemptions = [];
		let isLoading = true;
		let errorMsg = "";
		let isModalOpen = false;
		let selectedItem = null;
		async function loadData() {
			isLoading = true;
			try {
				redemptions = (await apiFetch("/admin/redemptions")).map((u) => {
					const quota = u.quota || 0;
					return {
						...u,
						displayStatus: u.status === 1 ? i18n.t.channels.active : "Used/Disabled",
						formattedQuota: `$ ${(Number(quota) / session.quotaPerUnit).toFixed(2)}`,
						usageStr: `${u.used_count || 0} / ${u.count || 0}`
					};
				});
			} catch (err) {
				errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : i18n.lang === "zh" ? "加载兑换码失败" : "Failed to load redemptions";
			} finally {
				isLoading = false;
			}
		}
		let columns = derived(() => [
			{
				key: "id",
				label: i18n.t.redemptions.id
			},
			{
				key: "name",
				label: i18n.t.redemptions.name
			},
			{
				key: "key",
				label: i18n.t.redemptions.codeKey
			},
			{
				key: "formattedQuota",
				label: i18n.t.redemptions.quota
			},
			{
				key: "usageStr",
				label: i18n.t.redemptions.usedTotal
			},
			{
				key: "displayStatus",
				label: i18n.t.tokens.status
			}
		]);
		function handleEdit(item) {
			selectedItem = item;
			isModalOpen = true;
		}
		async function handleDelete(item) {
			if (!confirm(`Are you sure you want to delete redemption code "${item.name}"?`)) return;
			try {
				await apiFetch(`/admin/redemptions/${item.id}`, { method: "DELETE" });
				await loadData();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSave(data) {
			try {
				if (selectedItem) await apiFetch(`/admin/redemptions/${selectedItem.id}`, {
					method: "PUT",
					body: JSON.stringify(data)
				});
				else await apiFetch("/admin/redemptions", {
					method: "POST",
					body: JSON.stringify(data)
				});
				isModalOpen = false;
				await loadData();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Gift($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.nav.redemptions || "Redemptions")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "管理和生成额度充值兑换码" : "Manage and generate top-up redemption codes")}</p></div> <div class="flex gap-3"><button class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">${escape_html(i18n.lang === "zh" ? "刷新列表" : "Refresh")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "生成兑换码" : "Generate")}</button></div></div> `);
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
					} else if (key === "displayStatus") {
						$$renderer.push("<!--[1-->");
						const isActive = value === i18n.t.channels.active;
						$$renderer.push(`<span${attr_class(`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stringify(isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400")}`)}>${escape_html(value)}</span>`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`${escape_html(value)}`);
					}
					$$renderer.push(`<!--]-->`);
				}
				DataTable($$renderer, {
					data: redemptions,
					columns: columns(),
					onEdit: handleEdit,
					onDelete: handleDelete,
					cell,
					$$slots: { cell: true }
				});
			}
		}
		$$renderer.push(`<!--]--></div> `);
		RedemptionModal($$renderer, {
			show: isModalOpen,
			redemption: selectedItem,
			onClose: () => isModalOpen = false,
			onSave: handleSave
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _page as default };
