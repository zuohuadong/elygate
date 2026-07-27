import { d as spread_props } from "./index-server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/cpu.svelte
function Cpu($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "cpu" },
		props,
		{ iconNode: [
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
		] }
	]));
}
//#endregion
export { Cpu as t };
