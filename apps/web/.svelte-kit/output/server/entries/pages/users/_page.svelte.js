import "../../../chunks/index-server.js";
import { N as escape_html, a as derived, j as attr, s as ensure_array_like } from "../../../chunks/server.js";
import { t as Gift } from "../../../chunks/gift.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Save } from "../../../chunks/save.js";
import { t as Users } from "../../../chunks/users.js";
import { t as X } from "../../../chunks/x.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
//#region src/components/UserModal.svelte
function UserModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show = false, user = null, onClose = () => {}, onSave = (data) => {} } = $$props;
		let formData = {
			username: "",
			password: "",
			role: 1,
			quotaAmount: 0,
			quotaCurrency: "USD",
			group: "default",
			status: 1
		};
		let isSubmitting = false;
		let userGroups = [];
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" tabindex="-1"><div class="bg-white dark:bg-slate-950 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"><div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"><h3 class="text-lg font-semibold text-slate-900 dark:text-white">${escape_html(user ? i18n.t.common.edit : i18n.t.common.add)} ${escape_html(i18n.t.users.title)}</h3> <button class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <div class="px-6 py-6 space-y-4 text-left">`);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <div class="space-y-1.5"><label for="u-username" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.users.username)}</label> <input id="u-username"${attr("value", formData.username)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="u-password" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.users.password)}</label> <input id="u-password" type="password"${attr("placeholder", user ? i18n.t.users.passwordEditPlaceholder : i18n.t.users.passwordPlaceholder)}${attr("value", formData.password)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="grid grid-cols-2 gap-4"><div class="space-y-1.5"><label for="u-role" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.users.role)}</label> `);
			$$renderer.select({
				id: "u-role",
				value: formData.role,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: 1 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.users.normalUser)}`);
				});
				$$renderer.option({ value: 10 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.users.admin)}`);
				});
			});
			$$renderer.push(`</div> <div class="space-y-1.5"><label for="u-quota" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.users.quota)}</label> <div class="flex gap-2"><input id="u-quota" type="number" step="0.01"${attr("value", formData.quotaAmount)} placeholder="e.g. 100.00" class="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/> `);
			$$renderer.select({
				value: formData.quotaCurrency,
				class: "shrink-0 w-[100px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: "USD" }, ($$renderer) => {
					$$renderer.push(`USD ($)`);
				});
				$$renderer.option({ value: "RMB" }, ($$renderer) => {
					$$renderer.push(`RMB (¥)`);
				});
			});
			$$renderer.push(`</div></div></div> <div class="grid grid-cols-2 gap-4"><div class="space-y-1.5"><label for="u-group" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.users.group)}</label> `);
			$$renderer.select({
				id: "u-group",
				value: formData.group,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				if (userGroups.length > 0) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<!--[-->`);
					const each_array = ensure_array_like(userGroups);
					for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
						let g = each_array[$$index];
						$$renderer.option({ value: g.key }, ($$renderer) => {
							$$renderer.push(`${escape_html(g.name)} (${escape_html(g.key)})`);
						});
					}
					$$renderer.push(`<!--]-->`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.option({ value: formData.group }, ($$renderer) => {
						$$renderer.push(`${escape_html(formData.group)}`);
					});
				}
				$$renderer.push(`<!--]-->`);
			});
			$$renderer.push(`</div> <div class="space-y-1.5"><label for="u-status" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.users.status)}</label> `);
			$$renderer.select({
				id: "u-status",
				value: formData.status,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: 1 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.users.active)}`);
				});
				$$renderer.option({ value: 2 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.users.disabled)}`);
				});
			});
			$$renderer.push(`</div></div></div> <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50"><button class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">${escape_html(i18n.t.common.cancel)}</button> <button${attr("disabled", isSubmitting, true)} class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors">`);
			$$renderer.push("<!--[-1-->");
			Save($$renderer, { class: "w-4 h-4" });
			$$renderer.push(`<!--]--> ${escape_html(i18n.t.common.save)}</button></div></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/components/GrantPackageModal.svelte
function GrantPackageModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show, user = null, onClose, onSave } = $$props;
		let packages = [];
		let selectedPackageId = "";
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0"><div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" role="button" aria-label="Close modal" tabindex="-1"></div> <div class="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden ring-1 ring-slate-200 dark:ring-slate-800 animate-in fade-in zoom-in-95 duration-200" role="dialog" aria-modal="true"><div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50"><h3 class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">`);
			Gift($$renderer, { class: "w-5 h-5 text-indigo-500" });
			$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "派发套餐" : "Grant Package")}</h3> <button class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <form class="p-6 space-y-5">`);
			if (user) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="p-4 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20"><p class="text-sm font-medium text-indigo-900 dark:text-indigo-300">${escape_html(i18n.lang === "zh" ? "目标用户：" : "Target User: ")} <span class="font-bold">${escape_html(user.username)}</span> (ID: ${escape_html(user.id)})</p></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			{
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<div><label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">${escape_html(i18n.lang === "zh" ? "选择套餐" : "Select Package")} <span class="text-rose-500">*</span></label> <div class="space-y-2 max-h-48 overflow-y-auto pr-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2">`);
				const each_array = ensure_array_like(packages);
				if (each_array.length !== 0) {
					$$renderer.push("<!--[-->");
					for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
						let pkg = each_array[$$index];
						$$renderer.push(`<label class="flex items-start p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-500/10"><input type="radio" name="package"${attr("value", String(pkg.id))}${attr("checked", selectedPackageId === String(pkg.id), true)} class="mt-1 flex-shrink-0 text-indigo-600 focus:ring-indigo-500" required=""/> <div class="ml-3 text-sm"><div class="font-medium text-slate-900 dark:text-white">${escape_html(pkg.name)}</div> `);
						if (pkg.description) {
							$$renderer.push("<!--[0-->");
							$$renderer.push(`<p class="text-slate-500 dark:text-slate-400 mt-0.5">${escape_html(pkg.description)}</p>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <div class="flex gap-3 mt-2 text-xs text-slate-500"><span>$${escape_html(Number(pkg.price).toFixed(2))}</span> <span>|</span> <span>${escape_html(pkg.duration_days)} ${escape_html(i18n.lang === "zh" ? "天有效" : "days")}</span></div></div></label>`);
					}
				} else {
					$$renderer.push("<!--[!-->");
					$$renderer.push(`<p class="text-sm text-slate-500 p-2">${escape_html(i18n.lang === "zh" ? "暂无可供派发的套餐，请先在前台创建。" : "No packages available. Create one first.")}</p>`);
				}
				$$renderer.push(`<!--]--></div></div>`);
			}
			$$renderer.push(`<!--]--> <div class="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800"><button type="button" class="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm focus:ring-2 focus:ring-slate-500/20">${escape_html(i18n.t.common?.cancel || "Cancel")}</button> <button type="submit"${attr("disabled", true, true)} class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed">${escape_html(i18n.lang === "zh" ? "确认发放" : "Grant")}</button></div></form></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/routes/users/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let users = [];
		let isLoading = true;
		let errorMsg = "";
		let isModalOpen = false;
		let selectedUser = null;
		let isGrantModalOpen = false;
		let grantSelectedUser = null;
		async function loadUsers() {
			isLoading = true;
			try {
				users = (await apiFetch("/admin/users")).map((u) => ({
					...u,
					displayRole: u.role >= 10 ? "Admin" : "Normal User",
					displayStatus: u.status === 1 ? i18n.t.users.active : i18n.t.users.disabled,
					formattedQuota: u.quota < 0 ? i18n.t.tokens.unlimited : `$ ${(Number(u.quota || 0) / session.quotaPerUnit).toFixed(2)}`,
					formattedUsed: `$ ${(Number(u.usedQuota || 0) / session.quotaPerUnit).toFixed(2)}`
				}));
			} catch (err) {
				errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : i18n.lang === "zh" ? "加载用户失败" : "Failed to load users";
			} finally {
				isLoading = false;
			}
		}
		const renderStatus = (val) => {
			return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${val === i18n.t.channels.active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400"}">${val}</span>`;
		};
		let columns = derived(() => [
			{
				key: "id",
				label: i18n.t.users.id
			},
			{
				key: "username",
				label: i18n.t.users.username
			},
			{
				key: "displayRole",
				label: i18n.t.users.role
			},
			{
				key: "group",
				label: i18n.t.users.group
			},
			{
				key: "formattedQuota",
				label: i18n.t.tokens.quota
			},
			{
				key: "formattedUsed",
				label: i18n.t.tokens.used
			},
			{
				key: "displayStatus",
				label: i18n.t.tokens.status,
				render: renderStatus
			}
		]);
		function handleEdit(user) {
			selectedUser = user;
			isModalOpen = true;
		}
		function handleGrantPackage(user) {
			grantSelectedUser = user;
			isGrantModalOpen = true;
		}
		async function handleDelete(user) {
			if (!confirm(`Are you sure you want to delete user "${user.username}"?`)) return;
			try {
				await apiFetch(`/admin/users/${user.id}`, { method: "DELETE" });
				await loadUsers();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSave(data) {
			try {
				if (selectedUser) await apiFetch(`/admin/users/${selectedUser.id}`, {
					method: "PUT",
					body: JSON.stringify(data)
				});
				else await apiFetch("/admin/users", {
					method: "POST",
					body: JSON.stringify(data)
				});
				isModalOpen = false;
				await loadUsers();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Users($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.nav.users)}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "管理平台注册用户，分配额度与用户组" : "Manage registered users, assign quotas and groups")}</p></div> <div class="flex gap-3"><button class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">${escape_html(i18n.lang === "zh" ? "刷新列表" : "Refresh")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.common.add)} User</button></div></div> `);
		if (isLoading) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		} else if (errorMsg) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">${escape_html(i18n.t.common.failed)}: ${escape_html(errorMsg)}</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			DataTable($$renderer, {
				data: users,
				columns: columns(),
				onEdit: handleEdit,
				onDelete: handleDelete,
				extraActions: [{
					label: i18n.lang === "zh" ? "派发套餐" : "Grant",
					class: "text-emerald-600 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300",
					onClick: handleGrantPackage
				}]
			});
		}
		$$renderer.push(`<!--]--></div> `);
		UserModal($$renderer, {
			show: isModalOpen,
			user: selectedUser,
			onClose: () => isModalOpen = false,
			onSave: handleSave
		});
		$$renderer.push(`<!----> `);
		GrantPackageModal($$renderer, {
			show: isGrantModalOpen,
			user: grantSelectedUser,
			onClose: () => isGrantModalOpen = false,
			onSave: () => {
				isGrantModalOpen = false;
				loadUsers();
			}
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _page as default };
