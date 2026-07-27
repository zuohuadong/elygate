import { N as escape_html } from "../../../chunks/server.js";
import { t as Settings } from "../../../chunks/settings.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import "../../../chunks/session.js";
//#region src/routes/settings/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Settings($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.nav.settings)}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.t.settings.desc)}</p></div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
export { _page as default };
