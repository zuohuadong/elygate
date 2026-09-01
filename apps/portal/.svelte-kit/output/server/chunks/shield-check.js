import { d as spread_props } from "./index-server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/shield-check.svelte
function Shield_check($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "shield-check" },
		props,
		{ iconNode: [["path", { "d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }], ["path", { "d": "m9 12 2 2 4-4" }]] }
	]));
}
//#endregion
export { Shield_check as t };
