import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/trending-up.svelte
function Trending_up($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "trending-up" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "M16 7h6v6" }], ["path", { "d": "m22 7-8.5 8.5-5-5L2 17" }]],
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
export { Trending_up as t };
