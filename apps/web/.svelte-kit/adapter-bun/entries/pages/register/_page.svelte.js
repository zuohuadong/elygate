import "../../../chunks/index-server.js";
import "../../../chunks/environment.js";
import { N as escape_html, c as head, j as attr } from "../../../chunks/server.js";
import "../../../chunks/shared.js";
import "../../../chunks/exports.js";
import "../../../chunks/internal.js";
import "../../../chunks/client.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import "../../../chunks/navigation.js";
//#region src/routes/register/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let username = "";
		let password = "";
		let confirmPassword = "";
		let inviteCode = "";
		let isLoading = false;
		let registerMode = "open";
		head("52fghe", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Elygate – Register</title>`);
			});
		});
		$$renderer.push(`<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 relative overflow-hidden"><div class="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none"></div> <div class="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/15 rounded-full blur-3xl pointer-events-none"></div> <div class="relative z-10 w-full max-w-md px-6"><div class="flex flex-col items-center mb-10"><div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-2xl shadow-indigo-500/30 mb-5"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg></div> <h1 class="text-3xl font-bold text-white tracking-tight">Elygate</h1> <p class="text-slate-400 text-sm mt-1">${escape_html(i18n.lang === "zh" ? "创建您的账户" : "Create your account")}</p></div> <div class="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-2xl"><h2 class="text-lg font-semibold text-white mb-6">${escape_html(i18n.lang === "zh" ? "注册" : "Register")}</h2> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <form class="space-y-5"><fieldset${attr("disabled", registerMode === "closed" || isLoading, true)} class="space-y-5 border-none p-0 m-0"><div><label for="username" class="block text-sm font-medium text-slate-300 mb-1.5">${escape_html(i18n.lang === "zh" ? "用户名" : "Username")}</label> <input id="username" type="text"${attr("value", username)} required=""${attr("placeholder", i18n.lang === "zh" ? "请输入用户名" : "Your username")} class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"/></div> <div><label for="password" class="block text-sm font-medium text-slate-300 mb-1.5">${escape_html(i18n.lang === "zh" ? "密码" : "Password")}</label> <input id="password" type="password"${attr("value", password)} required="" placeholder="••••••••" class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"/></div> <div><label for="confirm-password" class="block text-sm font-medium text-slate-300 mb-1.5">${escape_html(i18n.lang === "zh" ? "确认密码" : "Confirm Password")}</label> <input id="confirm-password" type="password"${attr("value", confirmPassword)} required="" placeholder="••••••••" class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"/></div> <div><label for="invite-code" class="block text-sm font-medium text-slate-300 mb-1.5">${escape_html(i18n.lang === "zh" ? "邀请码" : "Invite Code")} `);
		if (registerMode === "invite") {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<span class="text-rose-400">*</span>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<span class="text-slate-500 text-xs">(${escape_html(i18n.lang === "zh" ? "可选，使用邀请码可获得额外额度" : "Optional, get bonus quota with invite code")})</span>`);
		}
		$$renderer.push(`<!--]--></label> <input id="invite-code" type="text"${attr("value", inviteCode)}${attr("placeholder", i18n.lang === "zh" ? "请输入邀请码" : "Enter invite code")} class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"/></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <button type="submit"${attr("disabled", isLoading, true)} class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-medium rounded-xl text-sm transition-all duration-200">${escape_html(i18n.lang === "zh" ? "注册" : "Register")}</button></fieldset></form> <p class="text-xs text-slate-500 text-center mt-6">${escape_html(i18n.lang === "zh" ? "已有账户？" : "Already have an account?")} <a href="/login" class="text-indigo-400 hover:underline">${escape_html(i18n.lang === "zh" ? "立即登录" : "Sign in")}</a></p></div></div></div>`);
	});
}
//#endregion
export { _page as default };
