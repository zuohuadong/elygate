<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import ChannelModal from "../../components/ChannelModal.svelte";
    import { Plus, Server } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n";
    import { onMount } from "svelte";

    // Responsive state with Svelte 5 $state
    let channels = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    // Modal state
    let isModalOpen = $state(false);
    let selectedChannel = $state<any | null>(null);

    async function loadChannels() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/channels");
            channels = data.map((c) => ({
                ...c,
                displayStatus:
                    c.status === 1
                        ? i18n.t.channels.active
                        : i18n.t.channels.disabled,
                displayModels: Array.isArray(c.models)
                    ? c.models.join(",")
                    : c.models || "",
            }));
        } catch (err: any) {
            errorMsg = err.message || "Failed to load channels";
        } finally {
            isLoading = false;
        }
    }

    onMount(loadChannels);

    // Render status badge
    const renderStatus = (val: string) => {
        const isActive = val === i18n.t.channels.active;
        const colorClass = isActive
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
            : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}">${val}</span>`;
    };

    // Render models as small tags
    const renderModels = (val: string) => {
        if (!val) return `<small class="text-slate-400">None</small>`;
        const arr = val.split(",").slice(0, 3);
        let html = arr
            .map(
                (m) =>
                    `<span class="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 font-mono tracking-tighter shadow-sm border border-slate-200 dark:border-slate-700">${m.trim()}</span>`,
            )
            .join("");
        if (val.split(",").length > 3)
            html += `<span class="text-xs text-slate-400 ml-1">...</span>`;
        return html;
    };

    let columns = $derived([
        { key: "id", label: "ID" },
        { key: "name", label: i18n.t.channels.name },
        { key: "type", label: i18n.t.channels.type },
        {
            key: "displayModels",
            label: i18n.t.channels.models,
            render: renderModels,
        },
        { key: "weight", label: i18n.t.channels.weight },
        {
            key: "displayStatus",
            label: i18n.t.channels.status,
            render: renderStatus,
        },
    ]);

    function handleAdd() {
        selectedChannel = null;
        isModalOpen = true;
    }

    function handleEdit(channel: any) {
        selectedChannel = channel;
        isModalOpen = true;
    }

    async function handleDelete(channel: any) {
        const confirmMsg = i18n.t.common.confirmDelete.replace(
            "{name}",
            `"${channel.name}"`,
        );
        if (!confirm(confirmMsg)) return;
        try {
            await apiFetch(`/channels/${channel.id}`, { method: "DELETE" });
            await loadChannels();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }

    async function handleSave(data: any) {
        try {
            if (selectedChannel) {
                await apiFetch(`/channels/${selectedChannel.id}`, {
                    method: "PUT",
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch("/channels", {
                    method: "POST",
                    body: JSON.stringify(data),
                });
            }
            isModalOpen = false;
            await loadChannels();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }
</script>

<div class="flex-1 space-y-6 text-left">
    <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
    >
        <div>
            <h2
                class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white"
            >
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
            <button
                onclick={loadChannels}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.t.channels.add}
            </button>
        </div>
    </div>

    {#if isLoading}
        <div class="flex justify-center items-center py-12">
            <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"
            ></div>
        </div>
    {:else if errorMsg}
        <div
            class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400"
        >
            {i18n.t.common.failed}: {errorMsg}
        </div>
    {:else}
        <DataTable
            data={channels}
            {columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
        />
    {/if}
</div>

<ChannelModal
    show={isModalOpen}
    channel={selectedChannel}
    onClose={() => (isModalOpen = false)}
    onSave={handleSave}
/>
