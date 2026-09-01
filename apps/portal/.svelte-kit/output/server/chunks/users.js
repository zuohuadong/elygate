import { d as spread_props } from "./index-server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/activity.svelte
function Activity($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "activity" },
		props,
		{ iconNode: [["path", { "d": "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" }]] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/users.svelte
function Users($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "users" },
		props,
		{ iconNode: [
			["path", { "d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
			["path", { "d": "M16 3.128a4 4 0 0 1 0 7.744" }],
			["path", { "d": "M22 21v-2a4 4 0 0 0-3-3.87" }],
			["circle", {
				"cx": "9",
				"cy": "7",
				"r": "4"
			}]
		] }
	]));
}
//#endregion
export { Activity as n, Users as t };
