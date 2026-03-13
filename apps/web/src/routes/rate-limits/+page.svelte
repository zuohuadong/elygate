<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import RateLimitModal from "../../components/RateLimitModal.svelte";
    import { Plus, ShieldAlert } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";

    let rules = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    let isModalOpen = $state(false);
    let selectedRule = $state<any | null>(null);

    async function loadRules() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/admin/rate-limits");
            rules = data;
        } catch (err: any) {
            errorMsg = err.message || "Failed to load rate limits";
        } finally {
            isLoading = false;
        }
    }

    onMount(loadRules);

    let columns = $derived([
        { key: "id", label: "ID" },
        { key: "name", label: i18n.lang === "zh" ? "规则名称" : "Rule Name" },
        { key: "rpm", label: "RPM" },
        { key: "rph", label: "RPH" },
        { key: "concurrent", label: i18n.lang === "zh" ? "并发上限" : "Concurrent Limit" },
    ]);

    function handleAdd() {
        selectedRule = null;
        isModalOpen = true;
    }

    function handleEdit(rule: any) {
        selectedRule = rule;
        isModalOpen = true;
    }

    async function handleDelete(rule: any) {
        if (!confirm(i18n.lang === "zh" ? `确认删除限流规则 "${rule.name}" 吗？这可能导致正在使用此规则的套餐报错。` : `Delete rule "${rule.name}"?`)) return;
        try {
            await apiFetch(`/admin/rate-limits/${rule.id}`, {
                method: "DELETE",
            });
            await loadRules();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }

    async function handleSave(data: any) {
        try {
            if (selectedRule) {
                await apiFetch(`/admin/rate-limits/${selectedRule.id}`, {
                    method: "PUT",
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch("/admin/rate-limits", {
                    method: "POST",
                    body: JSON.stringify(data),
                });
            }
            isModalOpen = false;
            await loadRules();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }
</script>

<div class="flex-1 space-y-6 text-left max-w-5xl mx-auto w-full">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
            <h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">
                <ShieldAlert class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "限流规则" : "Rate Limits"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "配置全局或套餐专属的多维请求频率控制器。"
                    : "Configure global or package-specific frequency controllers."}
            </p>
        </div>
        <div class="flex gap-3">
            <button
                onclick={loadRules}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.lang === "zh" ? "新增规则" : "Add Rule"}
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
        <DataTable
            data={rules}
            {columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
        />
    {/if}
</div>

<RateLimitModal
    show={isModalOpen}
    rateLimit={selectedRule}
    onClose={() => (isModalOpen = false)}
    onSave={handleSave}
/>
