import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/key.svelte
function Key($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "key" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" }],
				["path", { "d": "m21 2-9.6 9.6" }],
				["circle", {
					"cx": "7.5",
					"cy": "15.5",
					"r": "5.5"
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
export { Key as t };
