import { N as escape_html, d as sanitize_props, f as slot, j as attr, m as stringify, p as spread_props, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Activity } from "../../../chunks/activity.js";
import { t as Clock } from "../../../chunks/clock.js";
import { t as Credit_card } from "../../../chunks/credit-card.js";
import { t as History } from "../../../chunks/history.js";
import { t as Trending_up } from "../../../chunks/trending-up.js";
import { t as Wallet_cards } from "../../../chunks/wallet-cards.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/target.svelte
function Target($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "target" },
		sanitize_props($$props),
		{
			iconNode: [
				["circle", {
					"cx": "12",
					"cy": "12",
					"r": "10"
				}],
				["circle", {
					"cx": "12",
					"cy": "12",
					"r": "6"
				}],
				["circle", {
					"cx": "12",
					"cy": "12",
					"r": "2"
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
//#region src/routes/consumer/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let userInfo = null;
		let logs = [];
		let stats = null;
		let activePeriod = "today";
		let topupCode = "";
		const periods = [
			{
				id: "today",
				label: "今天",
				labelEn: "Today"
			},
			{
				id: "yesterday",
				label: "昨天",
				labelEn: "Yesterday"
			},
			{
				id: "7d",
				label: "近7天",
				labelEn: "7 Days"
			},
			{
				id: "30d",
				label: "近30天",
				labelEn: "30 Days"
			}
		];
		function formatNumber(num) {
			return new Intl.NumberFormat("en-US").format(num);
		}
		$$renderer.push(`<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full"><div class="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">`);
		Wallet_cards($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "个人工作台" : "User Dashboard")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "查看您的使用统计与账户余额" : "Monitor your usage and account balance")}</p></div> <div class="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl w-fit"><!--[-->`);
		const each_array = ensure_array_like(periods);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let period = each_array[$$index];
			$$renderer.push(`<button${attr_class(`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${stringify(activePeriod === period.id ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white")}`)}>${escape_html(i18n.lang === "zh" ? period.label : period.labelEn)}</button>`);
		}
		$$renderer.push(`<!--]--></div></div> <div class="grid grid-cols-1 lg:grid-cols-3 gap-6"><div class="lg:col-span-1 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl p-6 text-white shadow-xl shadow-indigo-500/20 relative overflow-hidden h-fit"><div class="absolute top-0 right-0 p-4 opacity-10">`);
		Credit_card($$renderer, { class: "w-24 h-24" });
		$$renderer.push(`<!----></div> <h3 class="text-indigo-100 font-medium text-sm opacity-80">${escape_html(i18n.lang === "zh" ? "当前可用余额" : "Available Balance")}</h3> <div class="mt-2 flex items-baseline gap-2"><span class="text-4xl font-bold tracking-tight">${escape_html(session.currency === "RMB" ? "¥" : "$")}${escape_html(((userInfo?.quota || 0) / session.quotaPerUnit * (session.currency === "RMB" ? session.exchangeRate : 1)).toFixed(2))}</span> <span class="text-indigo-200 text-sm font-medium">${escape_html(session.currency)}</span></div> <div class="mt-8 pt-6 border-t border-white/10"><form class="space-y-3"><div class="flex gap-2"><input${attr("value", topupCode)}${attr("placeholder", i18n.lang === "zh" ? "输入兑换码" : "Redeem Code")} class="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-sm placeholder:text-indigo-200/50 outline-none focus:bg-white/20 transition-all"/> <button type="submit"${attr("disabled", !topupCode.trim(), true)} class="px-4 py-2 bg-white text-indigo-600 font-bold rounded-xl text-xs hover:bg-indigo-50 disabled:opacity-50 transition-all">${escape_html(i18n.lang === "zh" ? "兑换" : "Redeem")}</button></div></form></div></div> <div class="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4"><div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm"><div class="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">`);
		Activity($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> <span class="text-xs font-medium">${escape_html(i18n.lang === "zh" ? "请求总数" : "Requests")}</span></div> <div class="text-2xl font-bold tabular-nums">${escape_html(formatNumber(stats?.overview.total_requests || 0))}</div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm"><div class="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">`);
		Trending_up($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> <span class="text-xs font-medium">${escape_html(i18n.lang === "zh" ? "总消费" : "Total Cost")}</span></div> <div class="text-2xl font-bold tabular-nums">${escape_html(session.currency === "RMB" ? "¥" : "$")}${escape_html(((stats?.overview.total_cost || 0) / session.quotaPerUnit * (session.currency === "RMB" ? session.exchangeRate : 1)).toFixed(4))}</div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm"><div class="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">`);
		Clock($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> <span class="text-xs font-medium">${escape_html(i18n.t.dashboard.avgLatency)}</span></div> <div class="text-2xl font-bold tabular-nums">${escape_html(stats?.overview.avg_latency || 0)} <span class="text-xs text-slate-400">ms</span></div></div></div></div> <div class="grid grid-cols-1 lg:grid-cols-2 gap-6"><div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6"><h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-6 flex items-center gap-2">`);
		Trending_up($$renderer, { class: "w-4 h-4 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.dashboard.trafficTrend)}</h3> <div class="h-48 w-full relative">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<div class="h-full flex items-center justify-center text-slate-400 text-xs italic">${escape_html(i18n.t.common.noData)}</div>`);
		$$renderer.push(`<!--]--></div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6"><h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-6 flex items-center gap-2">`);
		Target($$renderer, { class: "w-4 h-4 text-rose-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.dashboard.modelDistribution)}</h3> <div class="space-y-4">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<div class="h-32 flex items-center justify-center text-slate-400 text-xs italic">${escape_html(i18n.t.common.noData)}</div>`);
		$$renderer.push(`<!--]--></div></div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm"><div class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between"><h3 class="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">`);
		History($$renderer, { class: "w-4 h-4 text-slate-400" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "最近使用记录" : "Recent usage")}</h3></div> <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="text-[10px] text-slate-500 bg-slate-50/50 dark:bg-slate-900/50 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800"><tr><th class="px-6 py-4 font-semibold">Model</th><th class="px-6 py-4 font-semibold text-center">Tokens</th><th class="px-6 py-4 font-semibold text-right">Cost</th></tr></thead><tbody class="divide-y divide-slate-100 dark:divide-slate-800"><!--[-->`);
		const each_array_2 = ensure_array_like(logs);
		for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
			let log = each_array_2[$$index_2];
			$$renderer.push(`<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"><td class="px-6 py-4"><div class="font-medium text-slate-900 dark:text-slate-200">${escape_html(log.modelName)}</div> <div class="text-[10px] text-slate-400 mt-0.5">${escape_html(new Date(log.createdAt).toLocaleString())}</div></td><td class="px-6 py-4 text-center text-slate-600 dark:text-slate-400 whitespace-nowrap">${escape_html(log.promptTokens + log.completionTokens)}</td><td class="px-6 py-4 text-right"><span class="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">${escape_html(session.currency === "RMB" ? "¥" : "$")}${escape_html((log.quotaCost / session.quotaPerUnit * (session.currency === "RMB" ? session.exchangeRate : 1)).toFixed(4))}</span></td></tr>`);
		}
		$$renderer.push(`<!--]--></tbody></table></div></div></div>`);
	});
}
//#endregion
export { _page as default };
