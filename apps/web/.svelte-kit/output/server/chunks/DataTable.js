import { N as escape_html, a as derived, g as html, j as attr, m as stringify, s as ensure_array_like, t as attr_class } from "./server.js";
import { t as Search } from "./search.js";
//#region src/components/DataTable.svelte
function DataTable($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data = [], columns = [], onEdit = void 0, onDelete = void 0, extraActions = [], pageSize = 10, currentPage = 1, total = 0, onPageChange = (page) => {}, searchable = true, customActions, cell } = $$props;
		let searchTerm = "";
		const filteredData = derived(() => {
			return data;
		});
		const effectiveTotal = derived(() => total || data.length);
		const effectiveData = derived(() => total > 0 ? data : filteredData().slice((currentPage - 1) * pageSize, currentPage * pageSize));
		const totalPages = derived(() => Math.ceil(effectiveTotal() / pageSize) || 1);
		const startItem = derived(() => effectiveTotal() === 0 ? 0 : (currentPage - 1) * pageSize + 1);
		const endItem = derived(() => Math.min(currentPage * pageSize, effectiveTotal()));
		$$renderer.push(`<div class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm">`);
		if (searchable) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30"><div class="relative max-w-sm"><div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">`);
			Search($$renderer, { class: "h-4 w-4 text-slate-400" });
			$$renderer.push(`<!----></div> <input type="text"${attr("value", searchTerm)} placeholder="Search..." class="block w-full pl-10 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"/></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="text-xs text-slate-500 uppercase bg-slate-50/50 dark:bg-slate-900/50 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800"><tr><!--[-->`);
		const each_array = ensure_array_like(columns);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let col = each_array[$$index];
			$$renderer.push(`<th scope="col" class="px-6 py-4 font-medium tracking-wider">${escape_html(col.label)}</th>`);
		}
		$$renderer.push(`<!--]--><th scope="col" class="px-6 py-4 text-right font-medium tracking-wider">操作</th></tr></thead><tbody class="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950">`);
		const each_array_1 = ensure_array_like(effectiveData());
		if (each_array_1.length !== 0) {
			$$renderer.push("<!--[-->");
			for (let i = 0, $$length = each_array_1.length; i < $$length; i++) {
				let row = each_array_1[i];
				$$renderer.push(`<tr class="hover:bg-slate-50/80 dark:hover:bg-slate-900/80 transition-colors duration-150 group"><!--[-->`);
				const each_array_2 = ensure_array_like(columns);
				for (let $$index_1 = 0, $$length = each_array_2.length; $$index_1 < $$length; $$index_1++) {
					let col = each_array_2[$$index_1];
					$$renderer.push(`<td class="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-slate-300">`);
					if (cell) {
						$$renderer.push("<!--[0-->");
						cell($$renderer, col.key, row[col.key], row);
						$$renderer.push(`<!---->`);
					} else if (col.render) {
						$$renderer.push("<!--[1-->");
						$$renderer.push(`${html(col.render(row[col.key], row))}`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`${escape_html(row[col.key])}`);
					}
					$$renderer.push(`<!--]--></td>`);
				}
				$$renderer.push(`<!--]--><td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">`);
				if (customActions) {
					$$renderer.push("<!--[0-->");
					customActions($$renderer, row);
					$$renderer.push(`<!---->`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <!--[-->`);
				const each_array_3 = ensure_array_like(extraActions);
				for (let $$index_2 = 0, $$length = each_array_3.length; $$index_2 < $$length; $$index_2++) {
					let action = each_array_3[$$index_2];
					if (!action.condition || action.condition(row)) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<button${attr_class(`${stringify(action.class)} mr-3 opacity-0 group-hover:opacity-100 transition-colors`)}>${escape_html(action.label)}</button>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				}
				$$renderer.push(`<!--]--> `);
				if (onEdit) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<button class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 transition-colors mr-3 opacity-0 group-hover:opacity-100">编辑</button>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (onDelete) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<button class="text-rose-600 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-300 transition-colors opacity-0 group-hover:opacity-100">删除</button>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></td></tr>`);
			}
		} else {
			$$renderer.push("<!--[!-->");
			$$renderer.push(`<tr><td${attr("colspan", columns.length + 1)} class="px-6 py-10 text-center text-slate-500 dark:text-slate-400">暂无相关数据</td></tr>`);
		}
		$$renderer.push(`<!--]--></tbody></table></div> <div class="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30"><span class="text-xs text-slate-500 dark:text-slate-400">`);
		if (effectiveTotal() > 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`显示 ${escape_html(startItem())} 到 ${escape_html(endItem())} 条，共 ${escape_html(effectiveTotal())} 条记录`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`暂无数据`);
		}
		$$renderer.push(`<!--]--></span> <div class="flex items-center gap-2"><span class="text-xs text-slate-500 dark:text-slate-400">第 ${escape_html(currentPage)} / ${escape_html(totalPages())} 页</span> <div class="inline-flex rounded-md shadow-sm"><button${attr("disabled", currentPage <= 1, true)} class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-l-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800">上一页</button> <button${attr("disabled", currentPage >= totalPages(), true)} class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-l-0 border-slate-200 rounded-r-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800">下一页</button></div></div></div></div>`);
	});
}
//#endregion
export { DataTable as t };
