import { N as escape_html, a as derived, d as sanitize_props, f as slot, j as attr, p as spread_props } from "../../chunks/server.js";
import { t as Icon } from "../../chunks/Icon.js";
import { t as Activity } from "../../chunks/activity.js";
import { n as Chart_column, t as Cpu } from "../../chunks/cpu.js";
import { t as Clock } from "../../chunks/clock.js";
import { t as Credit_card } from "../../chunks/credit-card.js";
import { t as Key } from "../../chunks/key.js";
import { t as Layers } from "../../chunks/layers.js";
import { t as Trending_up } from "../../chunks/trending-up.js";
import { t as Users } from "../../chunks/users.js";
import { t as Zap } from "../../chunks/zap.js";
import { t as i18n } from "../../chunks/index.svelte.js";
import { t as session } from "../../chunks/session.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/external-link.svelte
function External_link($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "external-link" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M15 3h6v6" }],
				["path", { "d": "M10 14 21 3" }],
				["path", { "d": "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }]
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
//#region src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let tokens = [];
		let recentLogs = [];
		let userInfo = {
			quota: 0,
			usedQuota: 0
		};
		let adminStats = null;
		const isAdmin = derived(() => session.role >= 10);
		let systemHealth = {
			online: 0,
			offline: 0,
			busy: 0
		};
		$$renderer.push(`<div class="flex-1 space-y-8 max-w-[1400px] mx-auto w-full pb-12"><div class="glass-card bg-gradient-to-br from-indigo-600/90 to-purple-700/90 text-white backdrop-blur-3xl overflow-hidden relative"><div class="absolute top-0 right-0 -mt-20 -mr-20 w-80 h-80 bg-white/10 rounded-full blur-3xl"></div> <div class="absolute bottom-0 left-0 -mb-20 -ml-20 w-60 h-60 bg-indigo-400/20 rounded-full blur-2xl"></div> <div class="relative flex items-center justify-between"><div><h1 class="text-3xl font-extrabold tracking-tight">${escape_html(i18n.lang === "zh" ? "欢迎回来" : "Welcome Back")}, <span class="text-indigo-200">${escape_html(session.username)}</span> 👋</h1> <p class="text-white/70 mt-2 font-medium">`);
		if (isAdmin()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`${escape_html(i18n.lang === "zh" ? "Elygate 工业级硬化网关正在平稳运行，实时掌控全局资源" : "Elygate Industrial-Grade gateway is running smoothly. Monitoring global resources in real-time.")}`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`${escape_html(i18n.lang === "zh" ? "这是您的专属 AI 网关工作台" : "Your specialized AI Gateway workspace.")}`);
		}
		$$renderer.push(`<!--]--></p> <div class="mt-6 flex gap-4"><div class="flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-wider"><div class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div> ${escape_html(systemHealth.online)} Online</div> `);
		if (systemHealth.offline > 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex items-center gap-2 px-3 py-1 bg-rose-500/20 rounded-full text-[10px] font-bold uppercase tracking-wider"><div class="w-2 h-2 rounded-full bg-rose-400"></div> ${escape_html(systemHealth.offline)} Offline</div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div> <div class="hidden md:flex gap-3 relative">`);
		if (isAdmin()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<a href="/channels" class="px-6 py-2.5 bg-white text-indigo-700 rounded-xl font-bold text-sm shadow-xl transition-all hover:scale-105 active:scale-95">${escape_html(i18n.lang === "zh" ? "部署渠道" : "Deploy Channel")}</a>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<a href="/tokens" class="px-6 py-2.5 bg-white text-indigo-700 rounded-xl font-bold text-sm shadow-xl transition-all hover:scale-105 active:scale-95">${escape_html(i18n.lang === "zh" ? "管理令牌" : "Manage Tokens")}</a>`);
		}
		$$renderer.push(`<!--]--></div></div></div> <div class="grid gap-6 md:grid-cols-3">`);
		if (isAdmin() && adminStats);
		else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="glass-card group"><div class="flex items-center justify-between"><div><h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest">${escape_html(i18n.lang === "zh" ? "账户余额" : "Balance")}</h3> <div class="text-3xl font-black text-slate-900 dark:text-white mt-2 font-mono">${escape_html(session.formatQuota(userInfo.quota - userInfo.usedQuota, 2))}</div></div> <div class="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center">`);
			Credit_card($$renderer, { class: "w-6 h-6 text-emerald-600 dark:text-emerald-400" });
			$$renderer.push(`<!----></div></div> <div class="mt-4"><a href="/payment" class="text-[10px] font-bold text-emerald-500 uppercase tracking-tighter hover:underline">${escape_html(i18n.lang === "zh" ? "充值" : "Recharge")} →</a></div></div> <div class="glass-card group"><div class="flex items-center justify-between"><div><h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest">${escape_html(i18n.lang === "zh" ? "活跃令牌" : "Active Tokens")}</h3> <div class="text-3xl font-black text-slate-900 dark:text-white mt-2 font-mono">${escape_html(tokens.filter((t) => t.status === 1).length)}</div></div> <div class="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">`);
			Key($$renderer, { class: "w-6 h-6 text-blue-600 dark:text-blue-400" });
			$$renderer.push(`<!----></div></div> <div class="mt-4"><a href="/tokens" class="text-[10px] font-bold text-blue-500 uppercase tracking-tighter hover:underline">${escape_html(i18n.lang === "zh" ? "管理" : "Manage")} →</a></div></div> <div class="glass-card group"><div class="flex items-center justify-between"><div><h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest">${escape_html(i18n.lang === "zh" ? "今日请求" : "Requests Today")}</h3> <div class="text-3xl font-black text-slate-900 dark:text-white mt-2 font-mono">${escape_html(recentLogs.length > 0 ? recentLogs.length : 0)}</div></div> <div class="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center">`);
			Activity($$renderer, { class: "w-6 h-6 text-purple-600 dark:text-purple-400" });
			$$renderer.push(`<!----></div></div> <div class="mt-4"><a href="/stats" class="text-[10px] font-bold text-purple-500 uppercase tracking-tighter hover:underline">${escape_html(i18n.lang === "zh" ? "统计" : "Stats")} →</a></div></div>`);
		}
		$$renderer.push(`<!--]--></div> <div class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-6 backdrop-blur-xl"><h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">`);
		Zap($$renderer, { class: "w-5 h-5 text-amber-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "快速操作" : "Quick Actions")}</h2> <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">`);
		if (isAdmin()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<a href="/channels" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center">`);
			Layers($$renderer, { class: "w-5 h-5 text-emerald-600 dark:text-emerald-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "渠道管理" : "Channels")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "管理上游 API 渠道" : "Manage upstream APIs")}</div></div></a> <a href="/users" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center">`);
			Users($$renderer, { class: "w-5 h-5 text-blue-600 dark:text-blue-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "用户管理" : "Users")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "管理系统用户信息" : "Manage user accounts")}</div></div></a> <a href="/models" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center">`);
			Cpu($$renderer, { class: "w-5 h-5 text-amber-600 dark:text-amber-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "模型管理" : "Models")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "配置模型与价格" : "Configure models & pricing")}</div></div></a> <a href="/stats" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-lg flex items-center justify-center">`);
			Chart_column($$renderer, { class: "w-5 h-5 text-purple-600 dark:text-purple-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "多维统计" : "Analytics")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "全站运营数据分析" : "System-wide analytics")}</div></div></a>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<a href="/tokens" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center">`);
			Key($$renderer, { class: "w-5 h-5 text-blue-600 dark:text-blue-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "创建令牌" : "Create Token")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "管理 API 密钥" : "Manage API keys")}</div></div></a> <a href="/consumer/docs" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center">`);
			External_link($$renderer, { class: "w-5 h-5 text-emerald-600 dark:text-emerald-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "API 文档" : "API Docs")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "查看使用指南" : "View usage guide")}</div></div></a> <a href="/payment" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center">`);
			Credit_card($$renderer, { class: "w-5 h-5 text-amber-600 dark:text-amber-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "充值" : "Recharge")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "添加账户余额" : "Add balance")}</div></div></a> <a href="/stats" class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"><div class="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-lg flex items-center justify-center">`);
			Trending_up($$renderer, { class: "w-5 h-5 text-purple-600 dark:text-purple-400" });
			$$renderer.push(`<!----></div> <div><div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${escape_html(i18n.lang === "zh" ? "数据统计" : "Statistics")}</div> <div class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "查看详细分析" : "View detailed analytics")}</div></div></a>`);
		}
		$$renderer.push(`<!--]--></div></div> <div class="grid gap-6 lg:grid-cols-2"><div class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-xl overflow-hidden"><div class="p-4 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between"><h2 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">`);
		Key($$renderer, { class: "w-4 h-4 text-blue-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "我的令牌" : "My Tokens")}</h2> <a href="/tokens" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">${escape_html(i18n.lang === "zh" ? "查看全部" : "View All")}</a></div> <div class="divide-y divide-slate-100 dark:divide-slate-800">`);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="p-8 text-center text-slate-500">${escape_html(i18n.lang === "zh" ? "加载中..." : "Loading...")}</div>`);
		$$renderer.push(`<!--]--></div></div> <div class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-xl overflow-hidden"><div class="p-4 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between"><h2 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">`);
		Clock($$renderer, { class: "w-4 h-4 text-purple-500" });
		$$renderer.push(`<!----> ${escape_html(isAdmin() ? i18n.lang === "zh" ? "全系统最近请求" : "System Recent Requests" : i18n.lang === "zh" ? "最近请求" : "Recent Requests")}</h2> <a${attr("href", isAdmin() ? "/logs" : "/logs")} class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">${escape_html(i18n.lang === "zh" ? "查看全部" : "View All")}</a></div> <div class="divide-y divide-slate-100 dark:divide-slate-800">`);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="p-8 text-center text-slate-500">${escape_html(i18n.lang === "zh" ? "加载中..." : "Loading...")}</div>`);
		$$renderer.push(`<!--]--></div></div></div></div>`);
	});
}
//#endregion
export { _page as default };
