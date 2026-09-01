import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/image.svelte
function Image($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "image" },
		sanitize_props($$props),
		{
			iconNode: [
				["rect", {
					"width": "18",
					"height": "18",
					"x": "3",
					"y": "3",
					"rx": "2",
					"ry": "2"
				}],
				["circle", {
					"cx": "9",
					"cy": "9",
					"r": "2"
				}],
				["path", { "d": "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }]
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
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/mic.svelte
function Mic($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "mic" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M12 19v3" }],
				["path", { "d": "M19 10v2a7 7 0 0 1-14 0v-2" }],
				["rect", {
					"x": "9",
					"y": "2",
					"width": "6",
					"height": "13",
					"rx": "3"
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
export { Image as n, Mic as t };
