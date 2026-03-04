<script lang="ts">
    import DataTable from "../../../components/DataTable.svelte";
    import { History, Search } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { onMount } from "svelte";
    import { i18n } from "$lib/i18n/index.svelte";

    let logs = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");
    let currentPage = $state(1);
    let totalItems = $state(0);
    const limit = 50;

    async function loadLogs(page: number) {
        isLoading = true;
        try {
            const res = await apiFetch<any>(
                `/auth/logs?page=${page}&limit=${limit}`,
            );
            totalItems = res.total || 0;
            // Map keys
            logs = res.data.map((l: any) => ({
                dt_created_at: new Date(l.createdAt).toLocaleString(),
                dt_model: l.modelName,
                dt_tokens: `${l.promptTokens} + ${l.completionTokens}`,
                dt_stream: l.isStream ? "SSE" : "JSON",
                dt_cost: `$${(l.quotaCost / 1000).toFixed(4)}`,
            }));
            currentPage = page;
        } catch (err: any) {
            errorMsg = err.message || "Failed to load logs";
        } finally {
            isLoading = false;
        }
    }

    onMount(() => {
        loadLogs(1);
    });

    const columns = [
        {
            key: "dt_created_at",
            label: i18n.lang === "zh" ? "请求时间" : "Time",
        },
        { key: "dt_model", label: i18n.lang === "zh" ? "模型名称" : "Model" },
        { key: "dt_tokens", label: "Tokens (P+C)" },
        { key: "dt_stream", label: i18n.lang === "zh" ? "模式" : "Mode" },
        { key: "dt_cost", label: i18n.lang === "zh" ? "消耗" : "Cost" },
    ];
</script>

<div class="flex-1 space-y-6 max-w-5xl mx-auto p-4 md:p-0">
    <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
    >
        <div>
            <h2
                class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white"
            >
                <History class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "我的接口日志" : "My API Logs"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "查看您的历史大模型调用与消耗明细"
                    : "View your historical model inference usage and cost records."}
            </p>
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
            {errorMsg}
        </div>
    {:else}
        <div
            class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
        >
            <DataTable data={logs} {columns} />

            <!-- Pagination -->
            <div
                class="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between"
            >
                <span class="text-sm text-slate-500">
                    {i18n.lang === "zh" ? "共" : "Total"}
                    {totalItems}
                    {i18n.lang === "zh" ? "条记录" : "records"}
                </span>
                <div class="flex gap-2">
                    <button
                        disabled={currentPage === 1}
                        onclick={() => loadLogs(currentPage - 1)}
                        class="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 disabled:opacity-50 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                    >
                        {i18n.lang === "zh" ? "上一页" : "Prev"}
                    </button>
                    <button
                        disabled={currentPage * limit >= totalItems}
                        onclick={() => loadLogs(currentPage + 1)}
                        class="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 disabled:opacity-50 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                    >
                        {i18n.lang === "zh" ? "下一页" : "Next"}
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>
