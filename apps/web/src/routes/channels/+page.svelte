<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import ChannelModal from "../../components/ChannelModal.svelte";
    import { Plus, Server } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";

    let channels = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    let isModalOpen = $state(false);
    let selectedChannel = $state<any | null>(null);

    async function loadChannels() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/admin/channels");
            channels = data.map((c) => {
                let statusLabel = i18n.t.channels.active;
                if (c.status === 2) statusLabel = i18n.t.channels.disabled;
                else if (c.status === 3) statusLabel = i18n.t.channels.offline;
                else if (c.status === 4) statusLabel = "Testing";
                else if (c.status === 5) statusLabel = i18n.t.channels.busy;

                // Parse key status
                const allKeys = (c.key || "").split("\n").map((k: string) => k.trim()).filter(Boolean);
                const keyStatus = c.keyStatus || {};
                const isKeyBad = (v: any) => {
                    if (typeof v === 'string') return v === 'exhausted' || v === 'invalid';
                    return v?.status === 'exhausted' || v?.status === 'invalid';
                };
                const exhaustedKeys = allKeys.filter((k: string) => isKeyBad(keyStatus[k]));

                // Build per-key detail for tooltip
                const keyDetails = exhaustedKeys.map((k: string) => {
                    const v = keyStatus[k];
                    const label = k.substring(0, 8) + '...';
                    if (typeof v === 'object' && v?.reason) {
                        return `${label}: ${v.status} - ${v.reason.substring(0, 60)}`;
                    }
                    return `${label}: ${typeof v === 'string' ? v : 'exhausted'}`;
                });

                return {
                    ...c,
                    displayStatus: statusLabel,
                    displayModels: Array.isArray(c.models) ? c.models.join(",") : c.models || "",
                    keyTotal: allKeys.length,
                    keyHealthy: allKeys.length - exhaustedKeys.length,
                    keyExhausted: exhaustedKeys.length,
                    keyReasons: keyDetails.join('\n'),
                };
            });
        } catch (err: unknown) {
            errorMsg = err instanceof Error ? err.message : String(err);
        } finally {
            isLoading = false;
        }
    }

    $effect(() => { loadChannels(); });

    const renderStatus = (val: string, row: Record<string, any>) => {
        let cc = "bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400";
        if (row.status === 1) cc = "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400";
        else if (row.status === 2 || row.status === 3) cc = "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400";
        else if (row.status === 5) cc = "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400";
        else if (row.status === 4) cc = "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-400";
        const tip = row.statusMessage ? `title="${row.statusMessage}"` : "";
        return `<span ${tip} class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-help ${cc}">${val}</span>`;
    };

    const renderKeys = (_val: string, row: Record<string, any>) => {
        if (row.keyTotal === 0) return `<span class="text-xs text-slate-400">—</span>`;
        if (row.keyExhausted === 0) {
            return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400">${row.keyHealthy}/${row.keyTotal}</span>`;
        }
        const color = row.keyHealthy === 0
            ? "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400"
            : "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400";
        const tip = row.keyReasons ? row.keyReasons.replace(/"/g, '&quot;') : `${row.keyExhausted} key(s) exhausted`;
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-help ${color}" title="${tip}">${row.keyHealthy}/${row.keyTotal}</span>`;
    };

    const renderModels = (val: string) => {
        if (!val) return `<small class="text-slate-400">None</small>`;
        const arr = val.split(",").slice(0, 3);
        let html = arr.map((m) =>
            `<span class="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 font-mono tracking-tighter shadow-sm border border-slate-200 dark:border-slate-700">${m.trim()}</span>`
        ).join("");
        if (val.split(",").length > 3) html += `<span class="text-xs text-slate-400 ml-1">...</span>`;
        return html;
    };

    let columns = $derived([
        { key: "id", label: "ID" },
        { key: "name", label: i18n.t.channels.name },
        { key: "type", label: i18n.t.channels.type },
        { key: "displayModels", label: i18n.t.channels.models, render: renderModels },
        { key: "weight", label: i18n.t.channels.weight },
        { key: "keyHealthy", label: i18n.lang === "zh" ? "密钥" : "Keys", render: renderKeys },
        { key: "displayStatus", label: i18n.t.channels.status, render: renderStatus },
    ]);

    function handleAdd() { selectedChannel = null; isModalOpen = true; }
    function handleEdit(channel: Record<string, any>) { selectedChannel = channel; isModalOpen = true; }

    async function handleDelete(channel: Record<string, any>) {
        if (!confirm(i18n.t.common.confirmDelete.replace("{name}", `"${channel.name}"`))) return;
        try {
            await apiFetch(`/admin/channels/${channel.id}`, { method: "DELETE" });
            await loadChannels();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }

    async function handleSave(data: Record<string, any>) {
        try {
            if (selectedChannel) {
                await apiFetch(`/admin/channels/${selectedChannel.id}`, { method: "PUT", body: JSON.stringify(data) });
            } else {
                await apiFetch("/admin/channels", { method: "POST", body: JSON.stringify(data) });
            }
            isModalOpen = false;
            await loadChannels();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }

    async function handleRestoreKeys(channel: Record<string, any>) {
        const msg = i18n.lang === "zh"
            ? `确定恢复渠道 "${channel.name}" 的所有密钥？`
            : `Restore all keys for "${channel.name}"?`;
        if (!confirm(msg)) return;
        try {
            const res = await apiFetch<any>(`/admin/channels/${channel.id}/keys/restore`, { method: "POST", body: "{}" });
            alert(i18n.lang === "zh"
                ? `已恢复 ${res.restoredCount} 个密钥${res.channelRestored ? '，渠道已恢复在线' : ''}`
                : `Restored ${res.restoredCount} key(s)${res.channelRestored ? ', channel back online' : ''}`);
            await loadChannels();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }

    async function handleSyncModels(channel: Record<string, any>) {
        try {
            const res = await apiFetch<any>(`/admin/channels/${channel.id}/sync-models`, { method: "POST" });
            alert(i18n.lang === "zh"
                ? `同步完成：${res.modelsCount} 个模型（新增 ${res.added}，移除 ${res.removed}）`
                : `Synced: ${res.modelsCount} models (+${res.added} -${res.removed})`);
            await loadChannels();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }

    async function handleTestChannel(channel: Record<string, any>) {
        try {
            const res = await apiFetch<any>(`/admin/channels/${channel.id}/test`, { method: "POST" });
            alert(res.success
                ? (i18n.lang === "zh" ? `测试成功 (${res.latency}ms)` : `Test OK (${res.latency}ms)`)
                : (i18n.lang === "zh" ? `测试失败: ${res.message}` : `Test failed: ${res.message}`));
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }

    let extraActions = $derived([
        { label: i18n.lang === "zh" ? "同步" : "Sync", class: "text-emerald-600 hover:text-emerald-800 dark:text-emerald-400", onClick: handleSyncModels },
        { label: i18n.lang === "zh" ? "测试" : "Test", class: "text-indigo-600 hover:text-indigo-800 dark:text-indigo-400", onClick: handleTestChannel },
        { label: i18n.lang === "zh" ? "恢复密钥" : "Restore Keys", class: "text-amber-600 hover:text-amber-800 dark:text-amber-400", onClick: handleRestoreKeys, condition: (row: any) => row.keyExhausted > 0 },
    ]);
</script>

<div class="flex-1 space-y-6 text-left w-full">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
            <h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">
                <Server class="w-6 h-6 text-indigo-500" />
                {i18n.t.channels.title}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "在此处管理上游大模型 API 转发节点，支持权重调度和自动探活。"
                    : "Manage upstream AI API nodes with weight scheduling and health checks."}
            </p>
        </div>
        <div class="flex gap-3">
            <button onclick={loadChannels}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm">
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors">
                <Plus class="w-4 h-4" />
                {i18n.t.channels.add}
            </button>
        </div>
    </div>

    {#if isLoading}
        <div class="flex justify-center items-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
    {:else if errorMsg}
        <div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">
            {i18n.t.common.failed}: {errorMsg}
        </div>
    {:else}
        <DataTable data={channels} {columns} onEdit={handleEdit} onDelete={handleDelete} {extraActions} />
    {/if}
</div>

<ChannelModal show={isModalOpen} channel={selectedChannel} onClose={() => (isModalOpen = false)} onSave={handleSave} />
