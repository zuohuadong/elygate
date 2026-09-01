import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/credit-card.svelte
function Credit_card($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "credit-card" },
		sanitize_props($$props),
		{
			iconNode: [["rect", {
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
			}]],
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
export { Credit_card as t };
