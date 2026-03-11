<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import RedemptionModal from "../../components/RedemptionModal.svelte";
    import CopyButton from "../../components/CopyButton.svelte";
    import { Plus, Gift } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";
    import { session } from "$lib/session.svelte";

    let redemptions = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    let isModalOpen = $state(false);
    let selectedItem = $state<any | null>(null);

    async function loadData() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/admin/redemptions");
            redemptions = data.map((u) => {
                const quota = u.quota || 0;
                return {
                    ...u,
                    displayStatus:
                        u.status === 1 ? i18n.t.channels.active : "Used/Disabled",
                    formattedQuota: `$ ${(Number(quota) / session.quotaPerUnit).toFixed(2)}`,
                    usageStr: `${u.used_count || 0} / ${u.count || 0}`,
                };
            });
        } catch (err: any) {
            errorMsg = err.message || (i18n.lang === "zh" ? "加载兑换码失败" : "Failed to load redemptions");
        } finally {
            isLoading = false;
        }
    }

    onMount(loadData);

    let columns = $derived([
        { key: "id", label: i18n.t.redemptions.id },
        { key: "name", label: i18n.t.redemptions.name },
        { key: "key", label: i18n.t.redemptions.codeKey },
        { key: "formattedQuota", label: i18n.t.redemptions.quota },
        { key: "usageStr", label: i18n.t.redemptions.usedTotal },
        { key: "displayStatus", label: i18n.t.tokens.status },
    ]);

    function handleAdd() {
        selectedItem = null;
        isModalOpen = true;
    }

    function handleEdit(item: any) {
        selectedItem = item;
        isModalOpen = true;
    }

    async function handleDelete(item: any) {
        if (
            !confirm(
                `Are you sure you want to delete redemption code "${item.name}"?`,
            )
        )
            return;
        try {
            await apiFetch(`/admin/redemptions/${item.id}`, {
                method: "DELETE",
            });
            await loadData();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }

    async function handleSave(data: any) {
        try {
            if (selectedItem) {
                await apiFetch(`/admin/redemptions/${selectedItem.id}`, {
                    method: "PUT",
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch("/admin/redemptions", {
                    method: "POST",
                    body: JSON.stringify(data),
                });
            }
            isModalOpen = false;
            await loadData();
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
                <Gift class="w-6 h-6 text-indigo-500" />
                {i18n.t.nav.redemptions || "Redemptions"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "管理和生成额度充值兑换码"
                    : "Manage and generate top-up redemption codes"}
            </p>
        </div>
        <div class="flex gap-3">
            <button
                onclick={loadData}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.lang === "zh" ? "生成兑换码" : "Generate"}
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
            data={redemptions}
            {columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
        >
            {#snippet cell(key, value, row)}
                {#if key === 'key'}
                    <div class="flex items-center gap-2">
                        <span class="font-mono text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 select-all cursor-pointer">
                            {value}
                        </span>
                        <CopyButton {value} />
                    </div>
                {:else if key === 'displayStatus'}
                    {@const isActive = value === i18n.t.channels.active}
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium {isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400'}">
                        {value}
                    </span>
                {:else}
                    {value}
                {/if}
            {/snippet}
        </DataTable>
    {/if}
</div>

<RedemptionModal
    show={isModalOpen}
    redemption={selectedItem}
    onClose={() => (isModalOpen = false)}
    onSave={handleSave}
/>
