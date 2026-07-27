import { _ as escape_html, c as ensure_array_like, d as spread_props, f as stringify, h as attr, r as attr_class } from "../../../chunks/index-server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { n as Chevron_left, t as Clock } from "../../../chunks/clock.js";
import { n as Search, t as Funnel } from "../../../chunks/funnel.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/chevron-right.svelte
function Chevron_right($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "chevron-right" },
		props,
		{ iconNode: [["path", { "d": "m9 18 6-6-6-6" }]] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/file-braces.svelte
function File_braces($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "file-braces" },
		props,
		{ iconNode: [
			["path", { "d": "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
			["path", { "d": "M14 2v5a1 1 0 0 0 1 1h5" }],
			["path", { "d": "M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" }],
			["path", { "d": "M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" }]
		] }
	]));
}
//#endregion
//#region src/routes/logs/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		const getStatusColor = (code) => {
			if (code >= 200 && code < 300) return "text-green-400 bg-green-400/10 border-green-400/20";
			if (code >= 400 && code < 500) return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
			return "text-red-400 bg-red-400/10 border-red-400/20";
		};
		function formatTokens(tokens) {
			if (tokens >= 1e3) return (tokens / 1e3).toFixed(1) + "k";
			return tokens;
		}
		$$renderer.push(`<div class="space-y-6"><div class="flex flex-wrap items-center justify-between gap-4"><div class="flex-1 min-w-[300px] relative">`);
		Search($$renderer, {
			class: "absolute left-3 top-1/2 -translate-y-1/2 text-gray-500",
			size: 18
		});
		$$renderer.push(`<!----> <input type="text" placeholder="Search by Trace ID, User, or Model..." class="w-full bg-[#161b22] border border-[#30363d] rounded-lg py-2 pl-10 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm outline-none"/></div> <div class="flex items-center gap-2"><a href="/logs/export" download="" class="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400 hover:bg-blue-500/20 transition-all">`);
		File_braces($$renderer, { size: 16 });
		$$renderer.push(`<!----> Export CSV</a> <button class="flex items-center gap-2 px-3 py-2 bg-white/5 border border-[#30363d] rounded-lg text-sm hover:bg-white/10 transition-all">`);
		Clock($$renderer, { size: 16 });
		$$renderer.push(`<!----> Last 24 Hours</button> <button class="flex items-center gap-2 px-3 py-2 bg-white/5 border border-[#30363d] rounded-lg text-sm hover:bg-white/10 transition-all">`);
		Funnel($$renderer, { size: 16 });
		$$renderer.push(`<!----> Status</button></div></div> <div class="glass-card overflow-hidden"><table class="w-full text-left border-collapse"><thead><tr class="border-b border-[#30363d] bg-white/[0.02]"><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Timestamp</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">User / Model</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tokens</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cost</th><th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Details</th></tr></thead><tbody class="divide-y divide-[#30363d]"><!--[-->`);
		const each_array = ensure_array_like(data.logs);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let log = each_array[$$index];
			$$renderer.push(`<tr class="hover:bg-white/[0.02] transition-colors group"><td class="px-6 py-4"><div class="flex flex-col"><span class="text-sm text-white font-mono">${escape_html(new Date(log.createdAt).toLocaleTimeString())}</span> <span class="text-[10px] text-gray-500">${escape_html(new Date(log.createdAt).toLocaleDateString())}</span></div></td><td class="px-6 py-4"><div class="flex flex-col"><span class="text-sm font-medium text-white">${escape_html(log.username)}</span> <span class="text-xs text-gray-400 flex items-center gap-1"><div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div> ${escape_html(log.modelName)}</span></div></td><td class="px-6 py-4"><span${attr_class(`px-2 py-0.5 rounded-full text-[10px] font-bold border ${stringify(getStatusColor(log.statusCode))}`)}>${escape_html(log.statusCode)}</span></td><td class="px-6 py-4"><div class="text-xs text-gray-300 font-mono"><span>${escape_html(formatTokens(log.promptTokens))}</span> <span class="text-gray-600 mx-1">+</span> <span>${escape_html(formatTokens(log.completionTokens))}</span></div></td><td class="px-6 py-4 font-mono text-sm text-gray-400">$${escape_html(log.quotaCost.toFixed(4))}</td><td class="px-6 py-4 text-right">`);
			if (log.hasDetails) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<a${attr("href", `/logs/${stringify(log.id)}`)} class="p-1.5 inline-flex items-center gap-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-md hover:bg-blue-500/20 transition-all text-xs">`);
				File_braces($$renderer, { size: 14 });
				$$renderer.push(`<!----> Inspect</a>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<span class="text-xs text-gray-600 italic">No payload</span>`);
			}
			$$renderer.push(`<!--]--></td></tr>`);
		}
		$$renderer.push(`<!--]--></tbody></table> <div class="px-6 py-4 border-t border-[#30363d] flex items-center justify-between bg-white/[0.01]"><p class="text-xs text-gray-500">Showing ${escape_html(data.logs.length)} logs on this page</p> <div class="flex items-center gap-2"><button class="p-1.5 border border-[#30363d] rounded-md hover:bg-white/5 disabled:opacity-30"${attr("disabled", data.currentPage === 1, true)}>`);
		Chevron_left($$renderer, { size: 16 });
		$$renderer.push(`<!----></button> <span class="text-xs font-medium text-white px-2">Page ${escape_html(data.currentPage)}</span> <button class="p-1.5 border border-[#30363d] rounded-md hover:bg-white/5">`);
		Chevron_right($$renderer, { size: 16 });
		$$renderer.push(`<!----></button></div></div></div></div>`);
	});
}
//#endregion
export { _page as default };
