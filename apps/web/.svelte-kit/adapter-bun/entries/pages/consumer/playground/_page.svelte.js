import { N as escape_html, d as sanitize_props, f as slot, j as attr, m as stringify, p as spread_props, s as ensure_array_like, t as attr_class } from "../../../../chunks/server.js";
import { t as Icon } from "../../../../chunks/Icon.js";
import { n as Code, t as Message_square } from "../../../../chunks/message-square.js";
import { t as i18n } from "../../../../chunks/index.svelte.js";
import "../../../../chunks/session.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/chevron-down.svelte
function Chevron_down($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "chevron-down" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "m6 9 6 6 6-6" }]],
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/play.svelte
function Play($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "play" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }]],
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/trash-2.svelte
function Trash_2($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "trash-2" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M10 11v6" }],
				["path", { "d": "M14 11v6" }],
				["path", { "d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
				["path", { "d": "M3 6h18" }],
				["path", { "d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]
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
//#region src/routes/consumer/playground/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let models = [];
		let selectedModel = "";
		let messages = [{
			role: "user",
			content: ""
		}];
		let rawResponse = null;
		let temperature = .7;
		let maxTokens = 1024;
		function updateRole(index, role) {
			messages = messages.map((m, i) => i === index ? {
				...m,
				role
			} : m);
		}
		$$renderer.push(`<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full"><div class="flex items-center justify-between"><div><h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">`);
		Play($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "API 测试" : "Playground")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "测试 API 请求，查看响应结果" : "Test API requests and view responses")}</p></div> <button class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg transition">`);
		Trash_2($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "清空" : "Clear")}</button></div> <div class="grid grid-cols-1 lg:grid-cols-2 gap-6"><div class="space-y-4"><div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">${escape_html(i18n.lang === "zh" ? "选择模型" : "Select Model")}</label> <div class="relative">`);
		$$renderer.select({
			value: selectedModel,
			class: "w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
		}, ($$renderer) => {
			$$renderer.push(`<!--[-->`);
			const each_array = ensure_array_like(models);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let model = each_array[$$index];
				$$renderer.option({ value: model.id }, ($$renderer) => {
					$$renderer.push(`${escape_html(model.id)}`);
				});
			}
			$$renderer.push(`<!--]-->`);
		});
		$$renderer.push(` `);
		Chevron_down($$renderer, { class: "w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" });
		$$renderer.push(`<!----></div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">${escape_html(i18n.lang === "zh" ? "参数设置" : "Parameters")}</h3> <div class="grid grid-cols-2 gap-4"><div><label class="block text-xs text-slate-500 mb-1">Temperature</label> <input type="range" min="0" max="2" step="0.1"${attr("value", temperature)} class="w-full"/> <div class="text-xs text-slate-400 text-right">${escape_html(temperature)}</div></div> <div><label class="block text-xs text-slate-500 mb-1">Max Tokens</label> <input type="number"${attr("value", maxTokens)} min="1" max="32000" class="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"/></div></div></div> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><div class="flex items-center justify-between mb-3"><h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">`);
		Message_square($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "消息" : "Messages")}</h3> <button class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ ${escape_html(i18n.lang === "zh" ? "添加消息" : "Add Message")}</button></div> <div class="space-y-3"><!--[-->`);
		const each_array_1 = ensure_array_like(messages);
		for (let index = 0, $$length = each_array_1.length; index < $$length; index++) {
			let message = each_array_1[index];
			$$renderer.push(`<div class="flex gap-2 items-start">`);
			$$renderer.select({
				value: message.role,
				onchange: (e) => updateRole(index, e.currentTarget.value),
				class: "px-2 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
			}, ($$renderer) => {
				$$renderer.option({ value: "system" }, ($$renderer) => {
					$$renderer.push(`system`);
				});
				$$renderer.option({ value: "user" }, ($$renderer) => {
					$$renderer.push(`user`);
				});
				$$renderer.option({ value: "assistant" }, ($$renderer) => {
					$$renderer.push(`assistant`);
				});
			});
			$$renderer.push(` <textarea${attr("placeholder", i18n.lang === "zh" ? "输入消息内容..." : "Enter message...")} rows="2" class="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500">`);
			const $$body = escape_html(message.content);
			if ($$body) $$renderer.push(`${$$body}`);
			$$renderer.push(`</textarea> `);
			if (messages.length > 1) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<button class="p-2 text-slate-400 hover:text-red-500 transition">`);
				Trash_2($$renderer, { class: "w-4 h-4" });
				$$renderer.push(`<!----></button>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></div></div> <button${attr("disabled", true, true)} class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white font-medium rounded-xl transition">`);
		$$renderer.push("<!--[-1-->");
		Play($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "发送请求" : "Send Request")}`);
		$$renderer.push(`<!--]--></button></div> <div class="space-y-4">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden"><div class="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800"><h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">`);
		Code($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "响应" : "Response")}</h3> <div class="flex items-center gap-2"><button${attr_class(`text-xs px-3 py-1 rounded-lg ${stringify("bg-slate-100 dark:bg-slate-800 text-slate-500")}`)}>${escape_html("Formatted")}</button> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div> <div class="p-4 min-h-[300px] max-h-[500px] overflow-auto">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<div class="flex items-center justify-center h-full text-slate-400 text-sm">${escape_html(i18n.lang === "zh" ? "发送请求后查看响应" : "Send a request to see the response")}</div>`);
		$$renderer.push(`<!--]--></div></div> `);
		if (rawResponse?.usage) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4"><h4 class="text-xs font-medium text-slate-500 mb-2">${escape_html(i18n.lang === "zh" ? "使用统计" : "Usage")}</h4> <div class="grid grid-cols-3 gap-4 text-center"><div><div class="text-lg font-bold text-slate-900 dark:text-white">${escape_html(rawResponse.usage.prompt_tokens)}</div> <div class="text-xs text-slate-500">Prompt</div></div> <div><div class="text-lg font-bold text-slate-900 dark:text-white">${escape_html(rawResponse.usage.completion_tokens)}</div> <div class="text-xs text-slate-500">Completion</div></div> <div><div class="text-lg font-bold text-slate-900 dark:text-white">${escape_html(rawResponse.usage.total_tokens)}</div> <div class="text-xs text-slate-500">Total</div></div></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div></div>`);
	});
}
//#endregion
export { _page as default };
