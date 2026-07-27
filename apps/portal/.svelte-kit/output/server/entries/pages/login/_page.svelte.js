import { _ as escape_html, d as spread_props, h as attr, l as head } from "../../../chunks/index-server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Key } from "../../../chunks/key.js";
import "../../../chunks/navigation.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/log-in.svelte
function Log_in($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "log-in" },
		props,
		{ iconNode: [
			["path", { "d": "m10 17 5-5-5-5" }],
			["path", { "d": "M15 12H3" }],
			["path", { "d": "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" }]
		] }
	]));
}
//#endregion
//#region src/routes/login/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let username = "";
		let password = "";
		let loading = false;
		head("1x05zx6", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Login - Elygate Portal</title>`);
			});
		});
		$$renderer.push(`<div class="min-h-screen flex items-center justify-center bg-[#0d1117] text-gray-200 p-6"><div class="w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden relative"><div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-600"></div> <div class="p-8"><div class="flex items-center gap-3 mb-8 justify-center"><div class="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">E</div> <span class="text-2xl font-bold tracking-tight text-white">Elygate <span class="text-blue-500">Portal</span></span></div> <div class="text-center mb-8"><h1 class="text-xl font-bold text-white mb-2">Sign in to your account</h1> <p class="text-sm text-gray-400">Enterprise portal access requires authorization</p></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <form class="space-y-6"><div><label for="username" class="block text-sm font-medium text-gray-300 mb-2">Username</label> <div class="relative relative-group"><div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">`);
		Key($$renderer, { size: 18 });
		$$renderer.push(`<!----></div> <input id="username" type="text"${attr("value", username)}${attr("disabled", loading, true)} class="block w-full pl-10 pr-3 py-3 border border-[#30363d] rounded-xl bg-[#0d1117] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all disabled:opacity-50" placeholder="username" required=""/></div></div> <div><label for="password" class="block text-sm font-medium text-gray-300 mb-2">Password</label> <input id="password" type="password"${attr("value", password)}${attr("disabled", loading, true)} class="block w-full px-4 py-3 border border-[#30363d] rounded-xl bg-[#0d1117] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all disabled:opacity-50" placeholder="••••••••" required=""/></div> <button type="submit"${attr("disabled", loading, true)} class="w-full flex items-center justify-center gap-2 px-4 py-3 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#161b22] focus:ring-blue-500 transition-all disabled:opacity-75 disabled:cursor-not-allowed">`);
		$$renderer.push("<!--[-1-->");
		Log_in($$renderer, { size: 18 });
		$$renderer.push(`<!----> <span>Sign In</span>`);
		$$renderer.push(`<!--]--></button></form> <div class="mt-8 text-center text-xs text-gray-500"><p>© ${escape_html((/* @__PURE__ */ new Date()).getFullYear())} Elygate Foundation. All rights reserved.</p></div></div></div></div>`);
	});
}
//#endregion
export { _page as default };
