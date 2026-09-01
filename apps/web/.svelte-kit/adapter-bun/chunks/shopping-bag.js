import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/shopping-bag.svelte
function Shopping_bag($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "shopping-bag" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M16 10a4 4 0 0 1-8 0" }],
				["path", { "d": "M3.103 6.034h17.794" }],
				["path", { "d": "M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" }]
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
export { Shopping_bag as t };
