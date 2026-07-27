import { N as escape_html, a as derived, d as sanitize_props, f as slot, j as attr, p as spread_props } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Plus } from "../../../chunks/plus.js";
import { t as Save } from "../../../chunks/save.js";
import { t as X } from "../../../chunks/x.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as apiFetch } from "../../../chunks/api.js";
import { t as DataTable } from "../../../chunks/DataTable.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/server.svelte
function Server($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "server" },
		sanitize_props($$props),
		{
			iconNode: [
				["rect", {
					"width": "20",
					"height": "8",
					"x": "2",
					"y": "2",
					"rx": "2",
					"ry": "2"
				}],
				["rect", {
					"width": "20",
					"height": "8",
					"x": "2",
					"y": "14",
					"rx": "2",
					"ry": "2"
				}],
				["line", {
					"x1": "6",
					"x2": "6.01",
					"y1": "6",
					"y2": "6"
				}],
				["line", {
					"x1": "6",
					"x2": "6.01",
					"y1": "18",
					"y2": "18"
				}]
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
//#region src/components/ChannelModal.svelte
function ChannelModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { show = false, channel = null, onClose = () => {}, onSave = (data) => {} } = $$props;
		let formData = {
			type: 1,
			name: "",
			baseUrl: "",
			key: "",
			models: "",
			modelMapping: "",
			weight: 1,
			status: 1,
			keyConcurrencyLimit: 0,
			keyStrategy: 0,
			priceRatio: 1
		};
		let isSubmitting = false;
		if (show) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" tabindex="-1"${attr("aria-label", channel ? i18n.t.common.edit : i18n.t.common.add)}><div class="bg-white dark:bg-slate-950 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"><div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"><h3 class="text-lg font-semibold text-slate-900 dark:text-white">${escape_html(channel ? i18n.t.common.edit : i18n.t.common.add)}</h3> <button class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors">`);
			X($$renderer, { class: "w-5 h-5" });
			$$renderer.push(`<!----></button></div> <div class="px-6 py-6 max-h-[70vh] overflow-y-auto space-y-4 text-left">`);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <div class="grid grid-cols-2 gap-4"><div class="space-y-1.5"><label for="ch-name" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.name)}</label> <input id="ch-name"${attr("value", formData.name)} placeholder="e.g., OpenAI Official" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="ch-type" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.type)}</label> `);
			$$renderer.select({
				id: "ch-type",
				value: formData.type,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: 1 }, ($$renderer) => {
					$$renderer.push(`OpenAI / Compatible`);
				});
				$$renderer.option({ value: 8 }, ($$renderer) => {
					$$renderer.push(`Azure / Microsoft`);
				});
				$$renderer.option({ value: 14 }, ($$renderer) => {
					$$renderer.push(`Anthropic Claude`);
				});
				$$renderer.option({ value: 15 }, ($$renderer) => {
					$$renderer.push(`Baidu Wenxin`);
				});
				$$renderer.option({ value: 17 }, ($$renderer) => {
					$$renderer.push(`Ali Qwen`);
				});
				$$renderer.option({ value: 18 }, ($$renderer) => {
					$$renderer.push(`Xunfei Spark`);
				});
				$$renderer.option({ value: 23 }, ($$renderer) => {
					$$renderer.push(`Google Gemini`);
				});
				$$renderer.option({ value: 24 }, ($$renderer) => {
					$$renderer.push(`Midjourney`);
				});
				$$renderer.option({ value: 31 }, ($$renderer) => {
					$$renderer.push(`DeepSeek`);
				});
				$$renderer.option({ value: 33 }, ($$renderer) => {
					$$renderer.push(`Cloudflare Worker AI`);
				});
				$$renderer.option({ value: 34 }, ($$renderer) => {
					$$renderer.push(`Flux`);
				});
				$$renderer.option({ value: 35 }, ($$renderer) => {
					$$renderer.push(`Udio`);
				});
				$$renderer.option({ value: 41 }, ($$renderer) => {
					$$renderer.push(`Nvidia API`);
				});
				$$renderer.option({ value: 42 }, ($$renderer) => {
					$$renderer.push(`Dakka Draw API (Sora/Veo)`);
				});
				$$renderer.option({ value: 100 }, ($$renderer) => {
					$$renderer.push(`ComfyUI Workspace`);
				});
			});
			$$renderer.push(`</div></div> <div class="space-y-1.5"><label for="ch-url" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.baseUrl)}</label> <input id="ch-url"${attr("value", formData.baseUrl)} placeholder="https://api.openai.com" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="ch-key" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.key)}</label> <textarea id="ch-key"${attr("placeholder", i18n.lang === "zh" ? "sk-...\nsk-...\n(每行一个密钥)" : "sk-...\nsk-...\n(One key per line)")}${attr("rows", 5)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all">`);
			const $$body = escape_html(formData.key);
			if ($$body) $$renderer.push(`${$$body}`);
			$$renderer.push(`</textarea></div> <div class="space-y-1.5"><label for="ch-models" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.models)}</label> <div class="flex gap-2"><input id="ch-models"${attr("value", formData.models)} placeholder="gpt-3.5-turbo,gpt-4" class="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/> <button type="button"${attr("disabled", !channel?.id, true)} class="px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors whitespace-nowrap">`);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`${escape_html(i18n.lang === "zh" ? "获取模型" : "Fetch Models")}`);
			$$renderer.push(`<!--]--></button></div> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> <div class="space-y-1.5"><label for="ch-mapping" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.modelMapping)}</label> <textarea id="ch-mapping" rows="3" placeholder="{&quot;gpt-4&quot;: &quot;gpt-4-32k&quot;}" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all">`);
			const $$body_1 = escape_html(formData.modelMapping);
			if ($$body_1) $$renderer.push(`${$$body_1}`);
			$$renderer.push(`</textarea></div> <div class="grid grid-cols-2 gap-4"><div class="space-y-1.5"><label for="ch-weight" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.weight)}</label> <input id="ch-weight" type="number"${attr("value", formData.weight)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="ch-status" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.t.channels.status)}</label> `);
			$$renderer.select({
				id: "ch-status",
				value: formData.status,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: 1 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.channels.active)}`);
				});
				$$renderer.option({ value: 2 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.t.channels.disabled)}`);
				});
			});
			$$renderer.push(`</div></div> <div class="grid grid-cols-2 gap-4"><div class="space-y-1.5"><label for="ch-strategy" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "多密钥策略" : "Key Strategy")}</label> `);
			$$renderer.select({
				id: "ch-strategy",
				value: formData.keyStrategy,
				class: "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
			}, ($$renderer) => {
				$$renderer.option({ value: 0 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.lang === "zh" ? "负载均衡 (随机)" : "Load Balance (Random)")}`);
				});
				$$renderer.option({ value: 1 }, ($$renderer) => {
					$$renderer.push(`${escape_html(i18n.lang === "zh" ? "依次消耗" : "Sequential")}`);
				});
			});
			$$renderer.push(`</div> <div class="space-y-1.5"><label for="ch-price-ratio" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "价格倍率 (USD=1.0)" : "Price Ratio (USD=1.0)")}</label> <input id="ch-price-ratio" type="number" step="0.0001"${attr("value", formData.priceRatio)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div> <div class="space-y-1.5"><label for="ch-concurrency" class="text-sm font-medium text-slate-700 dark:text-slate-300">${escape_html(i18n.lang === "zh" ? "单 Key 并发限制 (0=不限)" : "Key Concurrency (0=Unlimited)")}</label> <input id="ch-concurrency" type="number" min="0"${attr("value", formData.keyConcurrencyLimit)} class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"/></div></div></div> <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50"><button class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">${escape_html(i18n.t.common.cancel)}</button> <button${attr("disabled", isSubmitting, true)} class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors">`);
			$$renderer.push("<!--[-1-->");
			Save($$renderer, { class: "w-4 h-4" });
			$$renderer.push(`<!--]--> ${escape_html(i18n.t.common.save)}</button></div></div></div> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/routes/channels/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let channels = [];
		let isLoading = true;
		let errorMsg = "";
		let isModalOpen = false;
		let selectedChannel = null;
		async function loadChannels() {
			isLoading = true;
			try {
				channels = (await apiFetch("/admin/channels")).map((c) => {
					let statusLabel = i18n.t.channels.active;
					if (c.status === 2) statusLabel = i18n.t.channels.disabled;
					else if (c.status === 3) statusLabel = i18n.t.channels.offline;
					else if (c.status === 4) statusLabel = "Testing";
					else if (c.status === 5) statusLabel = i18n.t.channels.busy;
					const allKeys = (c.key || "").split("\n").map((k) => k.trim()).filter(Boolean);
					const keyStatus = c.keyStatus || {};
					const isKeyBad = (v) => {
						if (typeof v === "string") return v === "exhausted" || v === "invalid";
						return v?.status === "exhausted" || v?.status === "invalid";
					};
					const exhaustedKeys = allKeys.filter((k) => isKeyBad(keyStatus[k]));
					const keyDetails = exhaustedKeys.map((k) => {
						const v = keyStatus[k];
						const label = k.substring(0, 8) + "...";
						if (typeof v === "object" && v?.reason) return `${label}: ${v.status} - ${v.reason.substring(0, 60)}`;
						return `${label}: ${typeof v === "string" ? v : "exhausted"}`;
					});
					return {
						...c,
						displayStatus: statusLabel,
						displayModels: Array.isArray(c.models) ? c.models.join(",") : c.models || "",
						keyTotal: allKeys.length,
						keyHealthy: allKeys.length - exhaustedKeys.length,
						keyExhausted: exhaustedKeys.length,
						keyReasons: keyDetails.join("\n")
					};
				});
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : String(err);
			} finally {
				isLoading = false;
			}
		}
		const renderStatus = (val, row) => {
			let cc = "bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400";
			if (row.status === 1) cc = "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400";
			else if (row.status === 2 || row.status === 3) cc = "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400";
			else if (row.status === 5) cc = "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400";
			else if (row.status === 4) cc = "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-400";
			return `<span ${row.statusMessage ? `title="${row.statusMessage}"` : ""} class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-help ${cc}">${val}</span>`;
		};
		const renderKeys = (_val, row) => {
			if (row.keyTotal === 0) return `<span class="text-xs text-slate-400">—</span>`;
			if (row.keyExhausted === 0) return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400">${row.keyHealthy}/${row.keyTotal}</span>`;
			return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-help ${row.keyHealthy === 0 ? "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400" : "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400"}" title="${row.keyReasons ? row.keyReasons.replace(/"/g, "&quot;") : `${row.keyExhausted} key(s) exhausted`}">${row.keyHealthy}/${row.keyTotal}</span>`;
		};
		const renderModels = (val) => {
			if (!val) return `<small class="text-slate-400">None</small>`;
			let html = val.split(",").slice(0, 3).map((m) => `<span class="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 font-mono tracking-tighter shadow-sm border border-slate-200 dark:border-slate-700">${m.trim()}</span>`).join("");
			if (val.split(",").length > 3) html += `<span class="text-xs text-slate-400 ml-1">...</span>`;
			return html;
		};
		let columns = derived(() => [
			{
				key: "id",
				label: "ID"
			},
			{
				key: "name",
				label: i18n.t.channels.name
			},
			{
				key: "type",
				label: i18n.t.channels.type
			},
			{
				key: "displayModels",
				label: i18n.t.channels.models,
				render: renderModels
			},
			{
				key: "weight",
				label: i18n.t.channels.weight
			},
			{
				key: "keyHealthy",
				label: i18n.lang === "zh" ? "密钥" : "Keys",
				render: renderKeys
			},
			{
				key: "displayStatus",
				label: i18n.t.channels.status,
				render: renderStatus
			}
		]);
		function handleEdit(channel) {
			selectedChannel = channel;
			isModalOpen = true;
		}
		async function handleDelete(channel) {
			if (!confirm(i18n.t.common.confirmDelete.replace("{name}", `"${channel.name}"`))) return;
			try {
				await apiFetch(`/admin/channels/${channel.id}`, { method: "DELETE" });
				await loadChannels();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSave(data) {
			try {
				if (selectedChannel) await apiFetch(`/admin/channels/${selectedChannel.id}`, {
					method: "PUT",
					body: JSON.stringify(data)
				});
				else await apiFetch("/admin/channels", {
					method: "POST",
					body: JSON.stringify(data)
				});
				isModalOpen = false;
				await loadChannels();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleRestoreKeys(channel) {
			const msg = i18n.lang === "zh" ? `确定恢复渠道 "${channel.name}" 的所有密钥？` : `Restore all keys for "${channel.name}"?`;
			if (!confirm(msg)) return;
			try {
				const res = await apiFetch(`/admin/channels/${channel.id}/keys/restore`, {
					method: "POST",
					body: "{}"
				});
				alert(i18n.lang === "zh" ? `已恢复 ${res.restoredCount} 个密钥${res.channelRestored ? "，渠道已恢复在线" : ""}` : `Restored ${res.restoredCount} key(s)${res.channelRestored ? ", channel back online" : ""}`);
				await loadChannels();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleSyncModels(channel) {
			try {
				const res = await apiFetch(`/admin/channels/${channel.id}/sync-models`, { method: "POST" });
				alert(i18n.lang === "zh" ? `同步完成：${res.modelsCount} 个模型（新增 ${res.added}，移除 ${res.removed}）` : `Synced: ${res.modelsCount} models (+${res.added} -${res.removed})`);
				await loadChannels();
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		async function handleTestChannel(channel) {
			try {
				const res = await apiFetch(`/admin/channels/${channel.id}/test`, { method: "POST" });
				alert(res.success ? i18n.lang === "zh" ? `测试成功 (${res.latency}ms)` : `Test OK (${res.latency}ms)` : i18n.lang === "zh" ? `测试失败: ${res.message}` : `Test failed: ${res.message}`);
			} catch (err) {
				alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
			}
		}
		let extraActions = derived(() => [
			{
				label: i18n.lang === "zh" ? "同步" : "Sync",
				class: "text-emerald-600 hover:text-emerald-800 dark:text-emerald-400",
				onClick: handleSyncModels
			},
			{
				label: i18n.lang === "zh" ? "测试" : "Test",
				class: "text-indigo-600 hover:text-indigo-800 dark:text-indigo-400",
				onClick: handleTestChannel
			},
			{
				label: i18n.lang === "zh" ? "恢复密钥" : "Restore Keys",
				class: "text-amber-600 hover:text-amber-800 dark:text-amber-400",
				onClick: handleRestoreKeys,
				condition: (row) => row.keyExhausted > 0
			}
		]);
		$$renderer.push(`<div class="flex-1 space-y-6 text-left w-full"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">`);
		Server($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.channels.title)}</h2> <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escape_html(i18n.lang === "zh" ? "在此处管理上游大模型 API 转发节点，支持权重调度和自动探活。" : "Manage upstream AI API nodes with weight scheduling and health checks.")}</p></div> <div class="flex gap-3"><button class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">${escape_html(i18n.lang === "zh" ? "刷新列表" : "Refresh")}</button> <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors">`);
		Plus($$renderer, { class: "w-4 h-4" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.channels.add)}</button></div></div> `);
		if (isLoading) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex justify-center items-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`);
		} else if (errorMsg) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">${escape_html(i18n.t.common.failed)}: ${escape_html(errorMsg)}</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			DataTable($$renderer, {
				data: channels,
				columns: columns(),
				onEdit: handleEdit,
				onDelete: handleDelete,
				extraActions: extraActions()
			});
		}
		$$renderer.push(`<!--]--></div> `);
		ChannelModal($$renderer, {
			show: isModalOpen,
			channel: selectedChannel,
			onClose: () => isModalOpen = false,
			onSave: handleSave
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _page as default };
