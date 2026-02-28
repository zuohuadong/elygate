<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import { House, Search, Filter } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { onMount } from "svelte";

    // 本地状态
    let logs = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    onMount(async () => {
        try {
            const data = await apiFetch<any[]>("/logs");

            // 格式化呈现
            logs = data.map((l) => ({
                ...l,
                dt_created_at: new Date(l.createdAt).toLocaleString(),
                // 如果为空则显示无名 (为了简单化，实际项目中会联查对应字段)
                dt_user: `用户 ${l.userId}`,
                dt_model: l.modelName,
                dt_channel: l.channelId ? `渠道 ${l.channelId}` : "未知",
                dt_token: l.tokenId ? `Token ${l.tokenId}` : "直用",
                dt_cost: `$ ${(l.quotaCost / 1000).toFixed(4)}`,
                dt_duration: l.isStream ? "流式返回" : "标准",
                dt_status: "成功", // 纯消耗记录目前都算成功
            }));
        } catch (err: any) {
            errorMsg = err.message || "Failed to load logs";
        } finally {
            isLoading = false;
        }
    });

    const renderStatus = (val: string) => {
        if (val.includes("成功")) {
            return `<span class="text-emerald-600 dark:text-emerald-400 font-medium text-sm flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></span>${val}</span>`;
        }
        return `<span class="text-rose-600 dark:text-rose-400 font-medium text-sm flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-rose-500 mr-2"></span>${val}</span>`;
    };

    const columns = [
        { key: "dt_created_at", label: "时间" },
        { key: "dt_model", label: "请求模型" },
        { key: "dt_channel", label: "命中渠道" },
        { key: "dt_token", label: "令牌来源" },
        { key: "dt_user", label: "用户" },
        { key: "dt_duration", label: "通信模式" },
        { key: "dt_cost", label: "花费额度" },
        { key: "dt_status", label: "状态", render: renderStatus },
    ];
</script>

<div class="flex-1 space-y-6">
    <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
    >
        <div>
            <h2
                class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white"
            >
                <House class="w-6 h-6 text-indigo-500" />
                日志审核
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                全平台明细流水查询，包含消耗、上游耗时及流式状态记录。
            </p>
        </div>
        <div class="flex gap-3">
            <div class="relative w-72">
                <Search
                    class="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
                />
                <input
                    type="text"
                    placeholder="按模型、用户或渠道搜索..."
                    class="pl-9 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                />
            </div>
            <button
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                <Filter class="w-4 h-4" />
                高级筛选
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
            加载审计日志失败: {errorMsg}
        </div>
    {:else}
        <DataTable data={logs} {columns} />
    {/if}
</div>
