import "../../chunks/index-server.js";
import "../../chunks/environment.js";
import { N as escape_html } from "../../chunks/server.js";
import "../../chunks/shared.js";
import "../../chunks/exports.js";
import "../../chunks/internal.js";
import "../../chunks/client.js";
import { t as page } from "../../chunks/state.js";
//#region ../../node_modules/.bun/@sveltejs+kit@2.53.4+3624c556dc6fe184/node_modules/@sveltejs/kit/src/runtime/components/svelte-5/error.svelte
function Error($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<h1>${escape_html(page.status)}</h1> <p>${escape_html(page.error?.message)}</p>`);
	});
}
//#endregion
export { Error as default };
