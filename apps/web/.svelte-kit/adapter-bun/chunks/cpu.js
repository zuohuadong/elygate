import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/chart-column.svelte
function Chart_column($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "chart-column" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M3 3v16a2 2 0 0 0 2 2h16" }],
				["path", { "d": "M18 17V9" }],
				["path", { "d": "M13 17V5" }],
				["path", { "d": "M8 17v-3" }]
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/cpu.svelte
function Cpu($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "cpu" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M12 20v2" }],
				["path", { "d": "M12 2v2" }],
				["path", { "d": "M17 20v2" }],
				["path", { "d": "M17 2v2" }],
				["path", { "d": "M2 12h2" }],
				["path", { "d": "M2 17h2" }],
				["path", { "d": "M2 7h2" }],
				["path", { "d": "M20 12h2" }],
				["path", { "d": "M20 17h2" }],
				["path", { "d": "M20 7h2" }],
				["path", { "d": "M7 20v2" }],
				["path", { "d": "M7 2v2" }],
				["rect", {
					"x": "4",
					"y": "4",
					"width": "16",
					"height": "16",
					"rx": "2"
				}],
				["rect", {
					"x": "8",
					"y": "8",
					"width": "8",
					"height": "8",
					"rx": "1"
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
export { Chart_column as n, Cpu as t };
