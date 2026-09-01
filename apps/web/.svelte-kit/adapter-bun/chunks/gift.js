import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/gift.svelte
function Gift($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "gift" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M12 7v14" }],
				["path", { "d": "M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" }],
				["path", { "d": "M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5" }],
				["rect", {
					"x": "3",
					"y": "7",
					"width": "18",
					"height": "4",
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
export { Gift as t };
