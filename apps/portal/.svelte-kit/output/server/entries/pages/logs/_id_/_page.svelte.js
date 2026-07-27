import { _ as escape_html, d as spread_props, f as stringify, i as attr_style, o as derived } from "../../../../chunks/index-server.js";
import { t as Icon } from "../../../../chunks/Icon.js";
import { n as Chevron_left, t as Clock } from "../../../../chunks/clock.js";
import { t as Cpu } from "../../../../chunks/cpu.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/check.svelte
function Check($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "check" },
		props,
		{ iconNode: [["path", { "d": "M20 6 9 17l-5-5" }]] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/copy.svelte
function Copy($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "copy" },
		props,
		{ iconNode: [["rect", {
			"width": "14",
			"height": "14",
			"x": "8",
			"y": "8",
			"rx": "2",
			"ry": "2"
		}], ["path", { "d": "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/server.svelte
function Server($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "server" },
		props,
		{ iconNode: [
			["rect", {
				"width": "20",
				"height": "8",
				"x": "2",
				"y": "2",
				"rx": "2",
				"ry": "2"
			}],
			["rect", {
				"width": "20",
				"height": "8",
				"x": "2",
				"y": "14",
				"rx": "2",
				"ry": "2"
			}],
			["line", {
				"x1": "6",
				"x2": "6.01",
				"y1": "6",
				"y2": "6"
			}],
			["line", {
				"x1": "6",
				"x2": "6.01",
				"y1": "18",
				"y2": "18"
			}]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/terminal.svelte
function Terminal($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "terminal" },
		props,
		{ iconNode: [["path", { "d": "M12 19h8" }], ["path", { "d": "m4 17 6-6-6-6" }]] }
	]));
}
//#endregion
//#region src/routes/logs/[id]/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		let copied = {
			req: false,
			res: false
		};
		let log = derived(() => data.log);
		$$renderer.push(`<div class="space-y-6"><div class="flex items-center gap-4"><a href="/logs" class="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400">`);
		Chevron_left($$renderer, { size: 20 });
		$$renderer.push(`<!----></a> <h2 class="text-xl font-bold text-white">Log Details</h2> <span class="px-2 py-0.5 rounded-full text-[10px] font-mono border border-gray-700 bg-gray-800 text-gray-400">${escape_html(log().traceId || log().id)}</span></div> <div class="grid grid-cols-1 lg:grid-cols-3 gap-6"><div class="space-y-6"><div class="glass-card p-6 space-y-4"><h3 class="text-sm font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">`);
		Clock($$renderer, { size: 14 });
		$$renderer.push(`<!----> Metadata</h3> <div class="space-y-3"><div class="flex justify-between"><span class="text-xs text-gray-500">Timestamp</span> <span class="text-xs text-white">${escape_html(new Date(log().createdAt).toLocaleString())}</span></div> <div class="flex justify-between"><span class="text-xs text-gray-500">User</span> <span class="text-xs text-blue-400">${escape_html(log().username)}</span></div> <div class="flex justify-between"><span class="text-xs text-gray-500">Model</span> <span class="text-xs text-purple-400 font-mono">${escape_html(log().modelName)}</span></div> <div class="flex justify-between"><span class="text-xs text-gray-500">Latency</span> <span class="text-xs text-white">${escape_html(log().elapsedMs ?? 0)}ms</span></div> <div class="flex justify-between"><span class="text-xs text-gray-500">Cost</span> <span class="text-xs text-green-400">$${escape_html(log().quotaCost.toFixed(6))}</span></div></div></div> <div class="glass-card p-6 space-y-4"><h3 class="text-sm font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">`);
		Cpu($$renderer, { size: 14 });
		$$renderer.push(`<!----> Consumption</h3> <div class="space-y-2"><div class="flex items-center justify-between"><span class="text-xs text-gray-500">Prompt</span> <span class="text-xs font-mono text-white">${escape_html(log().promptTokens)}</span></div> <div class="flex items-center justify-between"><span class="text-xs text-gray-500">Completion</span> <span class="text-xs font-mono text-white">${escape_html(log().completionTokens)}</span></div> <div class="w-full h-1.5 bg-gray-800 rounded-full mt-2 overflow-hidden"><div class="h-full bg-blue-500"${attr_style(`width: ${stringify(log().promptTokens / Math.max(log().promptTokens + log().completionTokens, 1) * 100)}%`)}></div></div></div></div></div> <div class="lg:col-span-2 space-y-6"><div class="glass-card overflow-hidden"><div class="px-6 py-4 border-b border-[#30363d] flex items-center justify-between bg-white/[0.02]"><div class="flex items-center gap-2 text-sm font-semibold text-white">`);
		Terminal($$renderer, {
			size: 16,
			class: "text-blue-400"
		});
		$$renderer.push(`<!----> Request Payload</div> <button class="p-1.5 text-gray-500 hover:text-white transition-colors">`);
		if (copied.req) {
			$$renderer.push("<!--[0-->");
			Check($$renderer, {
				size: 14,
				class: "text-green-500"
			});
		} else {
			$$renderer.push("<!--[-1-->");
			Copy($$renderer, { size: 14 });
		}
		$$renderer.push(`<!--]--></button></div> <div class="p-6 overflow-x-auto"><pre class="text-xs font-mono text-gray-300 leading-relaxed">
                            ${escape_html(JSON.stringify(log().requestBody, null, 2))}
                    </pre></div></div> <div class="glass-card overflow-hidden"><div class="px-6 py-4 border-b border-[#30363d] flex items-center justify-between bg-white/[0.02]"><div class="flex items-center gap-2 text-sm font-semibold text-white">`);
		Server($$renderer, {
			size: 16,
			class: "text-purple-400"
		});
		$$renderer.push(`<!----> Response Payload</div> <button class="p-1.5 text-gray-500 hover:text-white transition-colors">`);
		if (copied.res) {
			$$renderer.push("<!--[0-->");
			Check($$renderer, {
				size: 14,
				class: "text-green-500"
			});
		} else {
			$$renderer.push("<!--[-1-->");
			Copy($$renderer, { size: 14 });
		}
		$$renderer.push(`<!--]--></button></div> <div class="p-6 overflow-x-auto">`);
		if (log().responseBody) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<pre class="text-xs font-mono text-gray-300 leading-relaxed">
                            ${escape_html(JSON.stringify(log().responseBody, null, 2))}
                        </pre>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<p class="text-xs italic text-gray-600">No response payload recorded (streaming or large payload).</p>`);
		}
		$$renderer.push(`<!--]--></div></div></div></div></div>`);
	});
}
//#endregion
export { _page as default };
