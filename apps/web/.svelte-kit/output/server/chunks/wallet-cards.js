import { d as sanitize_props, f as slot, p as spread_props } from "./server.js";
import { t as Icon } from "./Icon.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/wallet-cards.svelte
function Wallet_cards($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "wallet-cards" },
		sanitize_props($$props),
		{
			iconNode: [
				["rect", {
					"width": "18",
					"height": "18",
					"x": "3",
					"y": "3",
					"rx": "2"
				}],
				["path", { "d": "M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2" }],
				["path", { "d": "M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21" }]
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
export { Wallet_cards as t };
