import { _ as escape_html } from "../../chunks/index-server.js";
import { t as page } from "../../chunks/state.js";
//#region ../../node_modules/.bun/@sveltejs+kit@2.68.0+40f8dabd63692482/node_modules/@sveltejs/kit/src/runtime/components/svelte-5/error.svelte
function Error($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<h1>${escape_html(page.status)}</h1> <p>${escape_html(page.error?.message)}</p>`);
	});
}
//#endregion
export { Error as default };
