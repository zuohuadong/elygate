import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/search.svelte
function Search($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "search" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "m21 21-4.34-4.34" }], ["circle", {
				"cx": "11",
				"cy": "11",
				"r": "8"
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
export { Search as t };
