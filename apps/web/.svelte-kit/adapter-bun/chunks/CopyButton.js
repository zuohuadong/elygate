import { m as stringify, t as attr_class } from "./server.js";
import { t as Copy } from "./copy.js";
//#region src/components/CopyButton.svelte
function CopyButton($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { value, class: className = "" } = $$props;
		$$renderer.push(`<button${attr_class(`group/copy relative p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all active:scale-95 ${stringify(className)}`)} title="Copy to clipboard">`);
		$$renderer.push("<!--[-1-->");
		Copy($$renderer, { class: "w-3.5 h-3.5" });
		$$renderer.push(`<!--]--></button>`);
	});
}
//#endregion
export { CopyButton as t };
