import { _ as escape_html, c as ensure_array_like, d as spread_props, f as stringify, i as attr_style, o as derived, r as attr_class } from "../../chunks/index-server.js";
import { t as Icon } from "../../chunks/Icon.js";
import { n as Activity, t as Users } from "../../chunks/users.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/credit-card.svelte
function Credit_card($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "credit-card" },
		props,
		{ iconNode: [["rect", {
			"width": "20",
			"height": "14",
			"x": "2",
			"y": "5",
			"rx": "2"
		}], ["line", {
			"x1": "2",
			"x2": "22",
			"y1": "10",
			"y2": "10"
		}]] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/chart-column.svelte
function Chart_column($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "chart-column" },
		props,
		{ iconNode: [
			["path", { "d": "M3 3v16a2 2 0 0 0 2 2h16" }],
			["path", { "d": "M18 17V9" }],
			["path", { "d": "M13 17V5" }],
			["path", { "d": "M8 17v-3" }]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/chart-pie.svelte
function Chart_pie($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "chart-pie" },
		props,
		{ iconNode: [["path", { "d": "M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" }], ["path", { "d": "M21.21 15.89A10 10 0 1 1 8 2.83" }]] }
	]));
}
//#endregion
//#region src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		let stats = derived(() => [
			{
				name: "Total Quota",
				value: `$${(data.org.totalQuota / 1e6).toFixed(2)}M`,
				icon: Credit_card,
				color: "text-blue-500"
			},
			{
				name: "Used Quota",
				value: `$${(data.org.usedQuota / 1e6).toFixed(2)}M`,
				icon: Activity,
				color: "text-purple-500"
			},
			{
				name: "Active Members",
				value: data.analytics.activeMembers.toString(),
				icon: Users,
				color: "text-green-500"
			}
		]);
		let maxCost = derived(() => Math.max(...data.analytics.usageTrend.map((t) => t.cost), 1));
		let maxErrors = derived(() => Math.max(...data.analytics.usageTrend.map((t) => t.errors), 1));
		$$renderer.push(`<div class="space-y-8"><div class="grid grid-cols-1 md:grid-cols-3 gap-6"><!--[-->`);
		const each_array = ensure_array_like(stats());
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let stat = each_array[$$index];
			$$renderer.push(`<div class="glass-card glass-card-hover p-6"><div class="flex items-center justify-between mb-4"><div${attr_class(`p-2 bg-white/5 rounded-lg ${stringify(stat.color)}`)}>`);
			if (stat.icon) {
				$$renderer.push("<!--[-->");
				stat.icon($$renderer, { size: 24 });
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
			$$renderer.push(`</div></div> <div><p class="text-sm text-gray-400 font-medium">${escape_html(stat.name)}</p> <h3 class="text-2xl font-bold text-white mt-1">${escape_html(stat.value)}</h3></div></div>`);
		}
		$$renderer.push(`<!--]--></div> <div class="grid grid-cols-1 lg:grid-cols-3 gap-6"><div class="glass-card p-6 lg:col-span-2"><div class="flex items-center justify-between mb-6"><div class="flex items-center gap-2">`);
		Chart_column($$renderer, {
			size: 18,
			class: "text-blue-400"
		});
		$$renderer.push(`<!----> <h3 class="text-lg font-semibold text-white">24h Health &amp; Usage</h3></div> <div class="flex items-center gap-4 text-[10px]"><span class="flex items-center gap-1 text-blue-400"><div class="w-2 h-2 rounded-full bg-blue-400"></div> Cost</span> <span class="flex items-center gap-1 text-red-400"><div class="w-2 h-2 rounded-full bg-red-400"></div> Errors</span></div></div> <div class="h-64 flex items-end gap-1.5 px-2 relative"><!--[-->`);
		const each_array_1 = ensure_array_like(data.analytics.usageTrend);
		for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
			let hour = each_array_1[$$index_1];
			$$renderer.push(`<div class="flex-1 flex flex-col items-center gap-1 group relative"><div class="absolute -top-16 left-1/2 -translate-x-1/2 px-3 py-2 bg-gray-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none border border-white/10 shadow-xl"><div class="font-bold border-b border-white/5 pb-1 mb-1">${escape_html(hour.label)}</div> <div class="flex justify-between gap-4"><span>Cost:</span> <span class="text-blue-400">$${escape_html(hour.cost.toFixed(2))}</span></div> <div class="flex justify-between gap-4"><span>Errors:</span> <span class="text-red-400">${escape_html(hour.errors)}</span></div> <div class="flex justify-between gap-4"><span>Latency:</span> <span class="text-yellow-400">${escape_html(hour.latency)}ms</span></div></div> <div class="w-full bg-red-500/20 rounded-t-[2px] absolute bottom-0 transition-all group-hover:bg-red-500/40"${attr_style(`height: ${stringify(hour.errors / maxErrors() * 100)}%`)}></div> <div class="w-full bg-gradient-to-t from-blue-600/40 to-blue-400/90 rounded-t-[2px] transition-all group-hover:to-white z-10"${attr_style(`height: ${stringify(hour.cost / maxCost() * 100)}%`)}></div></div>`);
		}
		$$renderer.push(`<!--]--></div> <div class="flex justify-between mt-4 text-[10px] text-gray-500 font-mono border-t border-white/5 pt-2"><span>${escape_html(data.analytics.usageTrend[0]?.label || "00:00")}</span> <span>${escape_html(data.analytics.usageTrend[Math.floor(data.analytics.usageTrend.length / 2)]?.label || "12:00")}</span> <span>${escape_html(data.analytics.usageTrend[data.analytics.usageTrend.length - 1]?.label || "23:00")}</span></div></div> <div class="glass-card p-6"><div class="flex items-center gap-2 mb-6">`);
		Chart_pie($$renderer, {
			size: 18,
			class: "text-purple-400"
		});
		$$renderer.push(`<!----> <h3 class="text-lg font-semibold text-white">Top Models</h3></div> <div class="space-y-4">`);
		const each_array_2 = ensure_array_like(data.analytics.modelDistribution);
		if (each_array_2.length !== 0) {
			$$renderer.push("<!--[-->");
			for (let i = 0, $$length = each_array_2.length; i < $$length; i++) {
				let model = each_array_2[i];
				$$renderer.push(`<div class="space-y-1.5"><div class="flex items-center justify-between text-xs"><span class="text-gray-300 truncate max-w-[150px]">${escape_html(model.name)}</span> <span class="text-gray-500 font-mono">${escape_html(model.value)} calls</span></div> <div class="w-full h-1.5 bg-white/5 rounded-full overflow-hidden"><div${attr_class(`h-full rounded-full ${stringify([
					"bg-blue-500",
					"bg-purple-500",
					"bg-indigo-500",
					"bg-cyan-500",
					"bg-teal-500"
				][i % 5])}`)}${attr_style(`width: ${stringify(model.value / data.analytics.modelDistribution[0].value * 100)}%`)}></div></div></div>`);
			}
		} else {
			$$renderer.push("<!--[!-->");
			$$renderer.push(`<div class="h-full flex items-center justify-center text-gray-600 text-sm italic">No usage data yet</div>`);
		}
		$$renderer.push(`<!--]--></div></div></div></div>`);
	});
}
//#endregion
export { _page as default };
