import "../../../chunks/index-server.js";
import { N as escape_html, a as derived, j as attr, s as ensure_array_like } from "../../../chunks/server.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Shopping_bag } from "../../../chunks/shopping-bag.js";
import { t as X } from "../../../chunks/x.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
//#region src/components/PackageModal.svelte
function PackageModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show, pkg = null, onClose, onSave } = $$props;
		let formData = {
			name: "",
			description: "",
			cachePolicy: { mode: "smart" },
			price: 0,
			durationDays: 30,
			models: "",
			defaultRateLimitId: "",
			modelRateLimitsJson: "{}",
			cycleQuota: 0,
			cycleInterval: 1,
			cycleUnit: "day",
			isPublic: true
		};
		let rateLimits = [];
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0"><div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" role="button" aria-label="Close modal" tabindex="0"></div> <div class="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-800 animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]" role="dialog" aria-modal="true"><div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 shrink-0"><h3 class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">`);
			Shopping_bag($$renderer, { class: "w-5 h-5 text-indigo-500" });
			$$renderer.push(`<!----> ${escape_html(pkg ? i18n.t.packages.edit : i18n.t.packages.add)}</h3> <button class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <form class="p-6 space-y-5 overflow-y-auto"><div class="space-y-4"><div class="grid grid-cols-2 gap-4"><div class="col-span-2"><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="pkg-name">${escape_html(i18n.t.packages.name)} <span class="text-rose-500">*</span></label> <input type="text" id="pkg-name"${attr("value", formData.name)} required=""${attr("placeholder", i18n.t.packages.namePlaceholder)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors placeholder:text-slate-400"/></div> <div class="col-span-2"><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="pkg-desc">${escape_html(i18n.t.packages.description)}</label> <input type="text" id="pkg-desc"${attr("value", formData.description)}${attr("placeholder", i18n.t.packages.descriptionPlaceholder)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors placeholder:text-slate-400"/></div> <div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="pkg-price">${escape_html(i18n.t.packages.price)} <span class="text-xs text-slate-400">${escape_html(i18n.t.packages.priceUnit)}</span> <span class="text-rose-500">*</span></label> <input type="number" id="pkg-price" step="0.01" min="0"${attr("value", formData.price)} required="" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"/></div> <div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="pkg-duration">${escape_html(i18n.t.packages.duration)} <span class="text-xs text-slate-400">${escape_html(i18n.t.packages.durationUnit)}</span> <span class="text-rose-500">*</span></label> <input type="number" id="pkg-duration" min="1"${attr("value", formData.durationDays)} required="" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"/></div> <div class="col-span-2"><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="pkg-models">${escape_html(i18n.t.packages.models)} <span class="text-xs text-slate-400">${escape_html(i18n.t.packages.modelsTip)}</span> <span class="text-rose-500">*</span></label> <input type="text" id="pkg-models"${attr("value", formData.models)} required=""${attr("placeholder", i18n.t.packages.modelsPlaceholder)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors font-mono"/></div> <div class="col-span-2"><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="pkg-rate-limit">${escape_html(i18n.t.packages.defaultRateLimit)}</label> `);
			$$renderer.select({
				id: "pkg-rate-limit",
				value: formData.defaultRateLimitId,
				class: "w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
			}, ($$renderer) => {
				$$renderer.option({ value: "" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.noLimit)}`);
				});
				$$renderer.push(`<!--[-->`);
				const each_array = ensure_array_like(rateLimits);
				for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
					let rule = each_array[$$index];
					$$renderer.option({ value: String(rule.id) }, ($$renderer) => {
						$$renderer.push(`${escape_html(rule.name)} (RPM:${escape_html(rule.rpm)} RPH:${escape_html(rule.rph)} Concurrent:${escape_html(rule.concurrent)})`);
					});
				}
				$$renderer.push(`<!--]-->`);
			});
			$$renderer.push(`</div> <div class="col-span-2"><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="pkg-model-rate-limits">${escape_html(i18n.t.packages.modelRateLimits)}</label> <textarea id="pkg-model-rate-limits" rows="3" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors font-mono" placeholder="&quot;gpt-4o&quot;: 2, &quot;claude-3-5-sonnet&quot;: 3">`);
			const $$body = escape_html(formData.modelRateLimitsJson);
			if ($$body) $$renderer.push(`${$$body}`);
			$$renderer.push(`</textarea> <p class="text-xs text-slate-500 mt-1">${escape_html(i18n.t.packages.modelRateLimitsTip)} <code>${escape_html(i18n.t.packages.modelRateLimitsFormat)}</code></p></div> <div class="col-span-2 border-t border-slate-100 dark:border-slate-800 pt-4 mt-2"><h4 class="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-4">${escape_html(i18n.t.packages.cycleQuota)}</h4> <div class="grid grid-cols-2 gap-4"><div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="cycle-quota">${escape_html(i18n.t.packages.cycleQuota)}</label> <input type="number" id="cycle-quota" min="0"${attr("value", formData.cycleQuota)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"/> <p class="text-xs text-slate-400 mt-1">${escape_html(i18n.t.packages.cycleQuotaTip)}</p></div> <div class="grid grid-cols-2 gap-2"><div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="cycle-interval">${escape_html(i18n.t.packages.cycleInterval)}</label> <input type="number" id="cycle-interval" min="1"${attr("value", formData.cycleInterval)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"/></div> <div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="cycle-unit">${escape_html(i18n.t.packages.cycleUnit)}</label> `);
			$$renderer.select({
				id: "cycle-unit",
				value: formData.cycleUnit,
				class: "w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
			}, ($$renderer) => {
				$$renderer.option({ value: "hour" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.hour)}`);
				});
				$$renderer.option({ value: "day" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.day)}`);
				});
				$$renderer.option({ value: "week" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.week)}`);
				});
				$$renderer.option({ value: "month" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.month)}`);
				});
			});
			$$renderer.push(`</div></div></div></div> <div class="col-span-2 border-t border-slate-100 dark:border-slate-800 pt-4 mt-2"><h4 class="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-4">${escape_html(i18n.t.packages.cachePolicy)}</h4> <div class="grid grid-cols-2 gap-4"><div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" for="cache-policy">${escape_html(i18n.t.packages.cachePolicy)}</label> `);
			$$renderer.select({
				id: "cache-policy",
				value: formData.cachePolicy.mode,
				class: "w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
			}, ($$renderer) => {
				$$renderer.option({ value: "default" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.cachePolicyDefault)}`);
				});
				$$renderer.option({ value: "isolated" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.cachePolicyIsolated)}`);
				});
				$$renderer.option({ value: "smart" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.cachePolicySmart)}`);
				});
				$$renderer.option({ value: "disabled" }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.packages.cachePolicyDisabled)}`);
				});
			});
			$$renderer.push(`</div></div></div></div> <div class="flex items-center gap-2 pt-2"><input type="checkbox" id="pkg-public"${attr("checked", formData.isPublic, true)} class="w-4 h-4 text-indigo-600 bg-slate-100 border-slate-300 rounded focus:ring-indigo-500 dark:focus:ring-indigo-600 dark:ring-offset-slate-900 dark:bg-slate-800 dark:border-slate-700"/> <label for="pkg-public" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.packages.isPublic)}</label></div></div> <div class="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800 shrink-0"><button type="button" class="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm focus:ring-2 focus:ring-slate-500/20">${escape_html(i18n.t.common.cancel)}</button> <button type="submit" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900">${escape_html(i18n.t.common.save)}</button></div></form></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/routes/packages/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let packages = [];
		let isLoading = true;
		let errorMsg = "";
		let isModalOpen = false;
		let selectedPackage = null;
		async function loadPackages() {
			isLoading = true;
			try {
				packages = (await apiFetch("/admin/packages")).map((p) => ({
					...p,
					displayModels: Array.isArray(p.models) ? p.models.join(",") : p.models || "",
					displayPrice: `$${Number(p.price).toFixed(2)}`,
					displayDuration: `${p.duration_days} ${i18n.lang === "zh" ? "天" : "Days"}`,
					displayPublic: p.is_public ? i18n.lang === "zh" ? "公开" : "Public" : i18n.lang === "zh" ? "隐藏" : "Hidden",
					displayRateLimit: p.default_rate_limit_name || (i18n.lang === "zh" ? "无限制" : "No Limit")
				}));
			} catch (err) {
				errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : "Failed to load packages";
			} finally {
				isLoading = false;
			}
		}
		const renderModels = (val) => {
			if (!val) return `<small class="text-slate-400">None</small>`;
			let html = val.split(",").slice(0, 2).map((m) => `<span class="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 font-mono shadow-sm border border-slate-200 dark:border-slate-700">${m.trim()}</span>`).join("");
			if (val.split(",").length > 2) html += `<span class="text-xs text-slate-400 ml-1">...</span>`;
			return html;
		};
		const renderStatus = (val) => {
			return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${val === "Public" || val === "公开" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400"}">${val}</span>`;
		};
		let columns = derived(() => [
			{
				key: "id",
				label: "ID"
			},
			{
				key: "name",
				label: i18n.lang === "zh" ? "套餐名称" : "Package Name"
			},
			{
				key: "displayPrice",
				label: i18n.lang === "zh" ? "价格" : "Price"
			},
			{
				key: "displayDuration",
				label: i18n.lang === "zh" ? "周期" : "Duration"
			},
			{
				key: "displayModels",
				label: i18n.lang === "zh" ? "涵盖模型" : "Models",
				render: renderModels
			},
			{
				key: "displayRateLimit",
				label: i18n.lang === "zh" ? "默认限流" : "Default Rate Limit"
			},
			{
				key: "displayPublic",
				label: i18n.lang === "zh" ? "状态" : "Status",
				render: renderStatus
			}
		]);
		function handleEdit(pkg) {
			selectedPackage = pkg;
			isModalOpen = true;
		}
		async function handleDelete(pkg) {
			if (!confirm(i18n.lang === "zh" ? `确认删除套餐方案 "${pkg.name}" 吗？这只是下架套餐，已购买该套餐的用户不会受影响。` : `Delete package "${pkg.name}"?`)) return;
			try {
				await apiFetch(`/admin/packages/${pkg.id}`, { method: "DELETE" });
				await loadPackages();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSave(data) {
			try {
				if (selectedPackage) await apiFetch(`/admin/packages/${selectedPackage.id}`, {
					method: "PUT",
					body: JSON.stringify(data)
				});
				else await apiFetch("/admin/packages", {
					method: "POST",
					body: JSON.stringify(data)
				});
				isModalOpen = false;
				await loadPackages();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Shopping_bag($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "套餐方案" : "Packages")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "创建、定价与管理面向用户的月度等周期的组合模型授权方案。" : "Create, price, and manage duration-based access plans for users.")}</p></div> <div class="flex gap-3"><button class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">${escape_html(i18n.lang === "zh" ? "刷新列表" : "Refresh")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "新建套餐" : "New Package")}</button></div></div> `);
		if (isLoading) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		} else if (errorMsg) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">${escape_html(i18n.t.common.failed)}: ${escape_html(errorMsg)}</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			DataTable($$renderer, {
				data: packages,
				columns: columns(),
				onEdit: handleEdit,
				onDelete: handleDelete
			});
		}
		$$renderer.push(`<!--]--></div> `);
		PackageModal($$renderer, {
			show: isModalOpen,
			pkg: selectedPackage,
			onClose: () => isModalOpen = false,
			onSave: handleSave
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _page as default };
