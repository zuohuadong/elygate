<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import TokenModal from "../../components/TokenModal.svelte";
    import { KeyRound, Search, Plus, RefreshCw } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n";
    import { onMount } from "svelte";

    // Local state
    let tokens = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");
    let searchQuery = $state("");

    // Modal state
    let isModalOpen = $state(false);
    let selectedToken = $state<any | null>(null);

    async function loadTokens() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/tokens");
            tokens = data.map((t) => ({
                ...t,
                // Status 1-Active 2-Banned, mapping based on DB Schema
                dt_status:
                    t.status === 1
                        ? i18n.lang === "zh"
                            ? "正常"
                            : "Active"
                        : i18n.lang === "zh"
                          ? "禁用"
                          : "Banned",
                dt_created_at: new Date(t.createdAt).toLocaleString(),
                dt_remain_quota:
                    t.remainQuota === -1
                        ? i18n.t.tokens.unlimited
                        : `$ ${(t.remainQuota / 1000).toFixed(2)}`,
                dt_used_quota: `$ ${(t.usedQuota / 1000).toFixed(2)}`,
            }));
        } catch (err: any) {
            errorMsg = err.message || "Failed to load tokens";
        } finally {
            isLoading = false;
        }
    }

    onMount(loadTokens);

    const renderStatus = (val: string) => {
        const isActive = val === "正常" || val === "Active";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400"}"><span class="w-1.5 h-1.5 ${isActive ? "bg-emerald-500" : "bg-rose-500"} rounded-full mr-1.5"></span>${val}</span>`;
    };

    const renderKey = (val: string) => {
        return `<span class="font-mono text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 select-all cursor-pointer active:scale-95 transition-transform" title="Copy">${val}</span>`;
    };

    let filteredTokens = $derived(
        tokens.filter(
            (t) =>
                t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                t.key.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
    );

    let columns = $derived([
        { key: "name", label: i18n.t.tokens.name },
        { key: "key", label: i18n.t.tokens.key, render: renderKey },
        { key: "dt_remain_quota", label: i18n.t.tokens.quota },
        { key: "dt_used_quota", label: i18n.t.tokens.used },
        { key: "dt_status", label: i18n.t.tokens.status, render: renderStatus },
        { key: "dt_created_at", label: i18n.t.tokens.createdAt },
    ]);

    function handleAdd() {
        selectedToken = null;
        isModalOpen = true;
    }

    function handleEdit(token: any) {
        selectedToken = token;
        isModalOpen = true;
    }

    async function handleDelete(token: any) {
        const confirmMsg = i18n.t.common.confirmDelete.replace(
            "{name}",
            `"${token.name}"`,
        );
        if (!confirm(confirmMsg)) return;
        try {
            await apiFetch(`/tokens/${token.id}`, { method: "DELETE" });
            await loadTokens();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }

    async function handleSave(data: any) {
        try {
            if (selectedToken) {
                await apiFetch(`/tokens/${selectedToken.id}`, {
                    method: "PUT",
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch("/tokens", {
                    method: "POST",
                    body: JSON.stringify(data),
                });
            }
            isModalOpen = false;
            await loadTokens();
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
                <KeyRound class="w-6 h-6 text-indigo-500" />
                {i18n.t.tokens.title}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "向用户分发的下级鉴权令牌，支持额度限制和并发控制。"
                    : "Issue API keys to users with quota limits and concurrency control."}
            </p>
        </div>
        <div class="flex gap-3">
            <div class="relative w-64">
                <Search
                    class="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
                />
                <input
                    type="text"
                    bind:value={searchQuery}
                    placeholder={i18n.lang === "zh"
                        ? "搜索名称或 Key..."
                        : "Search name or key..."}
                    class="pl-9 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                />
            </div>
            <button
                onclick={loadTokens}
                class="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Refresh"
            >
                <RefreshCw class="w-4 h-4" />
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.t.tokens.add}
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
            data={filteredTokens}
            {columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
        />
    {/if}
</div>

<TokenModal
    show={isModalOpen}
    token={selectedToken}
    onClose={() => (isModalOpen = false)}
    onSave={handleSave}
/>
