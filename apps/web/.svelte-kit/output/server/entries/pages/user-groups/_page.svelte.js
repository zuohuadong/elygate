import "../../../chunks/index-server.js";
import { N as escape_html, a as derived, j as attr } from "../../../chunks/server.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Shield_alert } from "../../../chunks/shield-alert.js";
import { t as Users } from "../../../chunks/users.js";
import { t as X } from "../../../chunks/x.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
//#region src/components/UserGroupModal.svelte
function UserGroupModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show, group, onClose, onSave } = $$props;
		let formData = {
			key: "",
			name: "",
			description: "",
			allowedChannelTypes: "",
			deniedChannelTypes: "",
			allowedModels: "",
			deniedModels: "",
			allowedPackages: "",
			status: 1
		};
		derived(() => group?.key === "default" || group?.key === "cn-safe");
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0 bg-slate-900/50 backdrop-blur-sm" role="dialog" aria-modal="true" tabindex="-1"><div class="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]"><div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 shrink-0"><h3 class="text-lg font-semibold text-slate-900 dark:text-white">${escape_html(group ? i18n.lang === "zh" ? "编辑用户组" : "Edit Group" : i18n.lang === "zh" ? "新建用户组" : "New Group")}</h3> <button class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <div class="p-6 overflow-y-auto"><form id="group-form" class="space-y-6"><div class="grid grid-cols-1 sm:grid-cols-2 gap-6"><div class="space-y-1.5"><label for="key" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "唯一标识 (Key) *" : "Group Key *")}</label> <input id="key" type="text"${attr("value", formData.key)}${attr("disabled", !!group, true)} required="" placeholder="e.g. vip-group" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-900"/></div> <div class="space-y-1.5"><label for="name" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "显示名称 *" : "Display Name *")}</label> <input id="name" type="text"${attr("value", formData.name)} required="" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"/></div></div> <div class="space-y-1.5"><label for="description" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "描述" : "Description")}</label> <input id="description" type="text"${attr("value", formData.description)} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"/></div> <div class="border-t border-slate-200 dark:border-slate-800 pt-6"><h4 class="text-sm font-semibold text-slate-900 dark:text-white mb-4">${escape_html(i18n.lang === "zh" ? "维度 1: 渠道商 (Channel Types) 过滤" : "Dimension 1: Channel Provider Filter")}</h4> <div class="grid grid-cols-1 sm:grid-cols-2 gap-6"><div class="space-y-1.5"><label for="deniedChannelTypes" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "黑名单 (禁用类型)" : "Denied Types (Blacklist)")}</label> <input id="deniedChannelTypes" type="text"${attr("value", formData.deniedChannelTypes)} placeholder="e.g. 1, 14, 23 (用逗号分隔)" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"/> <p class="text-xs text-slate-500">${escape_html(i18n.lang === "zh" ? "绝杀对应公司所有模型，如填 1 则禁用所有 OpenAI。" : "Blocks entire companies (e.g. 1=OpenAI, 14=Anthropic).")}</p></div> <div class="space-y-1.5"><label for="allowedChannelTypes" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "白名单 (仅限类型)" : "Allowed Types (Whitelist)")}</label> <input id="allowedChannelTypes" type="text"${attr("value", formData.allowedChannelTypes)} placeholder="留空代表不限制" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"/></div></div></div> <div class="border-t border-slate-200 dark:border-slate-800 pt-6"><h4 class="text-sm font-semibold text-slate-900 dark:text-white mb-4">${escape_html(i18n.lang === "zh" ? "维度 2: 模型名称 (Model Name) 过滤" : "Dimension 2: Model Name Filter")}</h4> <div class="grid grid-cols-1 sm:grid-cols-2 gap-6"><div class="space-y-1.5"><label for="deniedModels" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "拦截通配符 (一行一个)" : "Denied Models (Wildcard)")}</label> <textarea id="deniedModels" rows="3" placeholder="sora-*\\ngpt-4-*\\nmidjourney*" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100 font-mono">`);
			const $$body = escape_html(formData.deniedModels);
			if ($$body) $$renderer.push(`${$$body}`);
			$$renderer.push(`</textarea></div> <div class="space-y-1.5"><label for="allowedModels" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "豁免通配符 (优先放行)" : "Allowed Models (Exemption)")}</label> <textarea id="allowedModels" rows="3" placeholder="用于在黑名单中特赦某个模型" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100 font-mono">`);
			const $$body_1 = escape_html(formData.allowedModels);
			if ($$body_1) $$renderer.push(`${$$body_1}`);
			$$renderer.push(`</textarea></div></div></div> <div class="border-t border-slate-200 dark:border-slate-800 pt-6"><div class="space-y-1.5"><label for="allowedPackages" class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "可见套餐流 (Package Isolation)" : "Allowed Packages")}</label> <input id="allowedPackages" type="text"${attr("value", formData.allowedPackages)} placeholder="e.g. 1, 3, 5 (留空则可见所有公开套餐)" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"/></div></div> <div class="pt-2"><label class="relative flex items-center cursor-pointer"><input type="checkbox" class="sr-only peer"${attr("checked", formData.status === 1, true)}/> <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 dark:peer-focus:ring-indigo-600 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div> <span class="ms-3 text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "启用该组" : "Enable Group")}</span></label></div></form></div> <div class="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end gap-3 shrink-0"><button type="button" class="px-4 py-2 text-sm font-medium tracking-wide text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700 transition-colors shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-slate-500">${escape_html(i18n.t.common.cancel)}</button> <button type="submit" form="group-form" class="px-4 py-2 text-sm font-medium tracking-wide text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">${escape_html(i18n.t.common.save)}</button></div></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/routes/user-groups/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let groups = [];
		let isLoading = true;
		let errorMsg = "";
		let isModalOpen = false;
		let selectedGroup = null;
		async function loadGroups() {
			isLoading = true;
			try {
				groups = (await apiFetch("/admin/user-groups")).map((g) => ({
					...g,
					displayModels: g.denied_models?.length > 0 ? i18n.lang === "zh" ? "有拦截规则" : "Has Blocks" : i18n.lang === "zh" ? "全放行" : "All Allowed",
					displayChannels: g.denied_channel_types?.length > 0 ? i18n.lang === "zh" ? "有过滤商" : "Filtered" : i18n.lang === "zh" ? "全放行" : "All Providers",
					displayStatus: g.status === 1 ? i18n.lang === "zh" ? "正常" : "Active" : i18n.lang === "zh" ? "禁用" : "Disabled"
				}));
			} catch (err) {
				errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : "Failed to load user groups";
			} finally {
				isLoading = false;
			}
		}
		const renderStatus = (val) => {
			return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${val === "Active" || val === "正常" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400"}">${val}</span>`;
		};
		const renderThreat = (val) => {
			return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${val.includes("拦截") || val.includes("Blocks") || val.includes("过滤") || val.includes("Filtered") ? "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400" : "text-slate-500"}">${val}</span>`;
		};
		let columns = derived(() => [
			{
				key: "key",
				label: i18n.lang === "zh" ? "标识(Key)" : "Group Key"
			},
			{
				key: "name",
				label: i18n.lang === "zh" ? "名称" : "Name"
			},
			{
				key: "displayChannels",
				label: i18n.lang === "zh" ? "渠道控制" : "Channel Rules",
				render: renderThreat
			},
			{
				key: "displayModels",
				label: i18n.lang === "zh" ? "模型控制" : "Model Rules",
				render: renderThreat
			},
			{
				key: "displayStatus",
				label: i18n.lang === "zh" ? "状态" : "Status",
				render: renderStatus
			}
		]);
		function handleEdit(group) {
			selectedGroup = group;
			isModalOpen = true;
		}
		async function handleDelete(group) {
			if (group.key === "default" || group.key === "cn-safe") {
				alert(i18n.lang === "zh" ? "系统内置组无法删除！" : "Cannot delete system default groups!");
				return;
			}
			if (!confirm(i18n.lang === "zh" ? `确认删除用户组 "${group.name}" 吗？如果有用户还在该组内将无法删除。` : `Delete group "${group.name}"?`)) return;
			try {
				await apiFetch(`/admin/user-groups/${group.key}`, { method: "DELETE" });
				await loadGroups();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSave(data) {
			try {
				if (selectedGroup) await apiFetch(`/admin/user-groups/${selectedGroup.key}`, {
					method: "PUT",
					body: JSON.stringify(data)
				});
				else await apiFetch("/admin/user-groups", {
					method: "POST",
					body: JSON.stringify(data)
				});
				isModalOpen = false;
				await loadGroups();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Users($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "用户组与合规策略" : "User Groups & Policies")}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "将用户分配到不同策略组，通过通道类型或通配符精细控制其可使用的模型库，规避法律风险。" : "Assign users to groups and control their model access via provider types or wildcards to ensure compliance.")}</p></div> <div class="flex gap-3"><button class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">${escape_html(i18n.lang === "zh" ? "刷新列表" : "Refresh")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "新建分组" : "New Group")}</button></div></div> `);
		if (isLoading) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		} else if (errorMsg) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">${escape_html(i18n.t.common.failed)}: ${escape_html(errorMsg)}</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			{
				function customActions($$renderer, group) {
					$$renderer.push(`<button class="text-amber-600 hover:text-amber-800 dark:text-amber-500 dark:hover:text-amber-400 transition-colors mr-2"${attr("title", i18n.lang === "zh" ? "一键中国合规净化" : "Apply Censorship Rules")}>`);
					Shield_alert($$renderer, { class: "w-4 h-4" });
					$$renderer.push(`<!----></button>`);
				}
				DataTable($$renderer, {
					data: groups,
					columns: columns(),
					onEdit: handleEdit,
					onDelete: handleDelete,
					customActions,
					$$slots: { customActions: true }
				});
			}
		}
		$$renderer.push(`<!--]--></div> `);
		UserGroupModal($$renderer, {
			show: isModalOpen,
			group: selectedGroup,
			onClose: () => isModalOpen = false,
			onSave: handleSave
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _page as default };
