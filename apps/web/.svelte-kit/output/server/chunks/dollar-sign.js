import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/dollar-sign.svelte
function Dollar_sign($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "dollar-sign" },
		sanitize_props($$props),
		{
			iconNode: [["line", {
				"x1": "12",
				"x2": "12",
				"y1": "2",
				"y2": "22"
			}], ["path", { "d": "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" }]],
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
export { Dollar_sign as t };
