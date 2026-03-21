<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import DataTableSkeleton from "../../components/DataTableSkeleton.svelte";
    import { House, Search, Filter, Download } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    

    import { i18n } from "$lib/i18n/index.svelte";
    import { session } from "$lib/session.svelte";

    // Local state
    let logs = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");
    let isExporting = $state(false);

    $effect(() => { (async () => {
        try {
            const response = await apiFetch<{ data: Record<string, any>[], total: number, page: number, limit: number } | any[]>("/admin/logs");
            
            // Handle both array and object response formats
            const data = Array.isArray(response) ? response : (response.data || []);

            // Format for display
            logs = data.map((l) => {
                let durationStr = l.is_stream || l.isStream ? "Stream" : "Standard";
                if (l.channel_id === -1 || l.channelId === -1) {
                    durationStr += ` <span class="text-amber-500 font-bold ml-1" title="Exact Match HIT">⚡</span>`;
                } else if (l.channel_id === 0 || l.channelId === 0) {
                    durationStr += ` <span class="text-emerald-500 font-bold ml-1" title="Semantic Cache HIT">🍃</span>`;
                }

                return {
                    ...l,
                    dt_created_at: new Date(l.created_at || l.createdAt).toLocaleString(),
                    dt_user: `User ${l.user_id || l.userId}`,
                    dt_model: l.model_name || l.modelName,
                    dt_channel: l.channel_id === -1 || l.channelId === -1 
                        ? (i18n.lang === "zh" ? "精确缓存" : "Exact Cache")
                        : (l.channel_id === 0 || l.channelId === 0)
                            ? (i18n.lang === "zh" ? "语义缓存" : "Semantic Cache")
                            : (l.channel_name || (l.channel_id ? `Channel ${l.channel_id}` : l.channelId ? `Channel ${l.channelId}` : "Unknown")),
                    dt_token: l.token_id ? `Token ${l.token_id}` : l.tokenId ? `Token ${l.tokenId}` : "Direct",
                    dt_cost: session.formatQuota(l.quota_cost || l.quotaCost || 0),
                    dt_duration: durationStr,
                    dt_latency: l.elapsed_ms ? `${l.elapsed_ms}ms` : "-",
                    dt_ip: l.ip_address || "unknown",
                    dt_ua: l.user_agent || "unknown",
                    dt_status: "Success",
                };
            });
        } catch (err: unknown) {
            errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : "Failed to load logs";
        } finally {
            isLoading = false;
        }
    })(); });

    async function exportLogs(format: 'csv' | 'json') {
        isExporting = true;
        try {
            const response = await fetch('/api/admin/logs/export?format=' + format, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `logs_export.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (err: unknown) {
            alert('Export failed: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            isExporting = false;
        }
    }

    const renderStatus = (val: string) => {
        if (val.includes("成功")) {
            return `<span class="text-emerald-600 dark:text-emerald-400 font-medium text-sm flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></span>${val}</span>`;
        }
        return `<span class="text-rose-600 dark:text-rose-400 font-medium text-sm flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-rose-500 mr-2"></span>${val}</span>`;
    };

    const columns = [
        { key: "dt_created_at", label: i18n.lang === "zh" ? "时间" : "Time" },
        { key: "dt_model", label: i18n.lang === "zh" ? "请求模型" : "Model" },
        { key: "dt_channel", label: i18n.lang === "zh" ? "命中渠道" : "Channel" },
        { key: "dt_token", label: i18n.lang === "zh" ? "令牌来源" : "Token" },
        { key: "dt_user", label: i18n.lang === "zh" ? "用户" : "User" },
        { key: "dt_duration", label: i18n.lang === "zh" ? "通信模式" : "Duration" },
        { key: "dt_latency", label: i18n.lang === "zh" ? "延迟" : "Latency" },
        { key: "dt_ip", label: "IP 地址" },
        { key: "dt_ua", label: "User Agent" },
        { key: "dt_cost", label: i18n.lang === "zh" ? "花费额度" : "Cost" },
        { key: "dt_status", label: i18n.lang === "zh" ? "状态" : "Status", render: renderStatus },
    ];
</script>

<div class="flex-1 space-y-6 w-full">
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
            <div class="relative">
                <button
                    onclick={() => {
                        const dropdown = document.getElementById('export-dropdown');
                        if (dropdown) dropdown.classList.toggle('hidden');
                    }}
                    class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
                    disabled={isExporting}
                >
                    <Download class="w-4 h-4" />
                    {isExporting ? 'Exporting...' : 'Export'}
                </button>
                <div id="export-dropdown" class="hidden absolute right-0 mt-2 w-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg z-10">
                    <button
                        onclick={() => { exportLogs('csv'); document.getElementById('export-dropdown')?.classList.add('hidden'); }}
                        class="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-t-lg"
                    >
                        Export as CSV
                    </button>
                    <button
                        onclick={() => { exportLogs('json'); document.getElementById('export-dropdown')?.classList.add('hidden'); }}
                        class="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-b-lg"
                    >
                        Export as JSON
                    </button>
                </div>
            </div>
        </div>
    </div>

    {#if isLoading}
        <DataTableSkeleton rows={8} columns={8} />
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
