<script module>
    import { Target } from "lucide-svelte";
</script>

<script lang="ts">
    import {
        Activity,
        DollarSign,
        RefreshCw,
        Calendar,
        Server,
        Zap,
        MousePointerClick,
        TrendingUp,
    } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount, onDestroy } from "svelte";

    // New types for the redesigned stats
    interface OverviewStats {
        total_requests: number;
        total_cost: number;
        total_prompt_tokens: number;
        total_completion_tokens: number;
        cached_tokens: number;
        cache_hits: number;
        cache_profit_quota: number;
        cache_size_bytes: number;
        cache_record_count: number;
        // New specific fields
        semantic_hits: number;
        semantic_profit_quota: number;
        semantic_tokens: number;
        exact_hits: number;
        exact_profit_quota: number;
        exact_tokens: number;
        semantic_cache_size: number;
        semantic_cache_count: number;
        exact_cache_size: number;
        exact_cache_count: number;
        avg_latency: number;
    }

    interface TimeSeriesPoint {
        date?: string;
        hour?: number;
        requests: number;
        cost: number;
    }

    interface ModelStat {
        model_name: string;
        requests: number;
        tokens: number;
        cost: number;
        success_rate: number;
        cost_percentage: number;
    }

    // State
    let activePeriod = $state("today");
    let isAutoRefresh = $state(true);
    let isLoading = $state(true);
    let lastRefresh = $state(new Date());

    let overview = $state<OverviewStats>({
        total_requests: 0,
        total_cost: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        cached_tokens: 0,
        cache_hits: 0,
        cache_profit_quota: 0,
        cache_size_bytes: 0,
        cache_record_count: 0,
        semantic_hits: 0,
        semantic_profit_quota: 0,
        semantic_tokens: 0,
        exact_hits: 0,
        exact_profit_quota: 0,
        exact_tokens: 0,
        semantic_cache_size: 0,
        semantic_cache_count: 0,
        exact_cache_size: 0,
        exact_cache_count: 0,
        avg_latency: 0,
    });
    let timeSeries = $state<TimeSeriesPoint[]>([]);
    let modelsUser = $state<ModelStat[]>([]);
    let modelsChannel = $state<ModelStat[]>([]);

    let refreshInterval: ReturnType<typeof setInterval>;

    const periods = [
        { id: "today", label: "今天", labelEn: "Today" },
        { id: "yesterday", label: "昨天", labelEn: "Yesterday" },
        { id: "7d", label: "近7天", labelEn: "7 Days" },
        { id: "30d", label: "近30天", labelEn: "30 Days" },
    ];

    async function fetchStats() {
        isLoading = true;
        try {
            // First fetch system settings to get configured timezone
            const options = await apiFetch<Record<string, string>>("/admin/options");
            const tz = options?.Timezone || "UTC";

            const data = await apiFetch<any>(
                `/admin/dashboard/period_stats?period=${activePeriod}&timezone=${encodeURIComponent(tz)}`,
            );
            if (data) {
                overview = data.overview || overview;
                modelsUser = data.models_user || [];
                modelsChannel = data.models_channel || [];
                timeSeries = data.time_series || [];
                lastRefresh = new Date();
            }
        } catch (e: any) {
            console.error("[Dashboard] Load Failed", e.message);
        } finally {
            isLoading = false;
        }
    }

    function setupAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        if (isAutoRefresh) {
            refreshInterval = setInterval(fetchStats, 30000); // 30s
        }
    }

    // Reactively re-fetch when period changes
    $effect(() => {
        void activePeriod;
        fetchStats();
    });

    onMount(() => {
        setupAutoRefresh();
    });

    onDestroy(() => {
        if (refreshInterval) clearInterval(refreshInterval);
    });

    function formatNumber(num: number) {
        return new Intl.NumberFormat("en-US").format(num);
    }

    function formatTokens(tokens: number) {
        if (tokens >= 1000000) return (tokens / 1000000).toFixed(2) + "M";
        if (tokens >= 1000) return (tokens / 1000).toFixed(2) + "k";
        return formatNumber(tokens);
    }
</script>

<div class="flex-1 space-y-6 max-w-[1400px] mx-auto w-full">
    <!-- Header with Filters -->
    <div
        class="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white/60 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-xl"
    >
        <div class="flex items-center gap-3">
            <div
                class="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-xl text-indigo-600 dark:text-indigo-400"
            >
                <Activity class="w-6 h-6" />
            </div>
            <div>
                <h2
                    class="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"
                >
                    {i18n.lang === "zh" ? "密钥统计" : "Key Statistics"}
                </h2>
                <div
                    class="flex items-center gap-2 text-xs text-slate-500 mt-0.5"
                >
                    <span class="flex items-center gap-1">
                        <span
                            class="w-2 h-2 rounded-full {isAutoRefresh
                                ? 'bg-emerald-500 animate-pulse'
                                : 'bg-slate-300 dark:bg-slate-600'}"
                        ></span>
                        {i18n.lang === "zh"
                            ? "每30秒自动刷新"
                            : "Auto-refresh every 30s"}
                    </span>
                    <span class="text-slate-300 dark:text-slate-600">|</span>
                    <span>{lastRefresh.toLocaleTimeString()}</span>
                </div>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
            <!-- Period Selector -->
            <div
                class="flex bg-slate-100/50 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/50"
            >
                {#each periods as p}
                    <button
                        onclick={() => (activePeriod = p.id)}
                        class="px-4 py-1.5 text-sm font-medium rounded-lg transition-all {activePeriod ===
                        p.id
                            ? 'bg-white dark:bg-slate-700 text-orange-500 dark:text-orange-400 shadow-sm border border-slate-200/50 dark:border-slate-600/50'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'}"
                    >
                        {i18n.lang === "zh" ? p.label : p.labelEn}
                    </button>
                {/each}
            </div>

            <!-- Custom Date Range (Visual Placeholder) -->
            <button
                class="flex items-center gap-2 px-4 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/80 transition-all"
            >
                <Calendar class="w-4 h-4 text-slate-400" />
                {new Date().toISOString().split("T")[0]}
            </button>

            <!-- Manual Refresh -->
            <button
                onclick={fetchStats}
                class="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/80 transition-all group"
            >
                <RefreshCw
                    class="w-4 h-4 {isLoading
                        ? 'animate-spin'
                        : 'group-hover:rotate-180 transition-transform duration-500'}"
                />
            </button>
        </div>
    </div>

    <!-- 4 Overview Cards -->
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <!-- 1. Total Requests -->
        <div
            class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm"
        >
            <h3
                class="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2"
            >
                {i18n.lang === "zh" ? "总请求数" : "Total Requests"}
            </h3>
            <div
                class="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight"
            >
                {formatNumber(overview.total_requests)}
            </div>
        </div>

        <!-- 2. Total Cost -->
        <div
            class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm"
        >
            <h3
                class="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2"
            >
                {i18n.lang === "zh" ? "总费用" : "Total Cost"}
            </h3>
            <div
                class="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight"
            >
                ${(overview.total_cost / 1000).toFixed(2)}
            </div>
        </div>

        <!-- 3. Total Tokens -->
        <div
            class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between gap-4"
        >
            <div>
                <h3
                    class="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2"
                >
                    {i18n.lang === "zh" ? "总Token数" : "Total Tokens"}
                </h3>
                <div
                    class="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight"
                >
                    {formatTokens(
                        Number(overview.total_prompt_tokens) +
                            Number(overview.total_completion_tokens),
                    )}
                </div>
            </div>
            <div
                class="flex justify-between items-center text-xs border-t border-slate-100 dark:border-slate-800 pt-3 mt-auto"
            >
                <div class="flex flex-col gap-1">
                    <span class="text-slate-400"
                        >{i18n.lang === "zh" ? "输入:" : "Prompt:"}
                        <span
                            class="text-slate-600 dark:text-slate-300 font-medium tabular-nums ml-1"
                            >{formatTokens(overview.total_prompt_tokens)}</span
                        ></span
                    >
                    <span class="text-slate-400"
                        >{i18n.lang === "zh" ? "输出:" : "Completion:"}
                        <span
                            class="text-slate-600 dark:text-slate-300 font-medium tabular-nums ml-1"
                            >{formatTokens(
                                overview.total_completion_tokens,
                            )}</span
                        ></span
                    >
                </div>
            </div>
        </div>

        <!-- 4. Semantic Cache -->
        <div
            class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between gap-4"
        >
            <div>
                <h3
                    class="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 flex items-center justify-between"
                >
                    <span>{i18n.lang === "zh" ? "语义缓存" : "Semantic Cache"}</span>
                    <span class="text-[10px] px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full font-semibold">
                        {i18n.lang === "zh" ? "纯利润" : "Pure Profit"}
                    </span>
                </h3>
                <div class="flex items-baseline gap-2">
                    <span class="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
                        ${((overview.semantic_profit_quota + overview.exact_profit_quota) / 1000).toFixed(2)}
                    </span>
                    <span class="text-xs text-slate-400 font-medium">
                        {i18n.lang === "zh" ? "盈利" : "Profit"}
                    </span>
                </div>
            </div>
            <div
                class="flex flex-col gap-2 text-xs border-t border-slate-100 dark:border-slate-800 pt-3 mt-auto"
            >
                <!-- Exact Cache Stats -->
                <div class="space-y-1">
                    <div class="flex justify-between w-full font-semibold text-amber-600 dark:text-amber-400">
                        <span>{i18n.lang === "zh" ? "⚡ 精确缓存:" : "⚡ Exact Cache:"}</span>
                        <span>{formatNumber(overview.exact_hits)} hit</span>
                    </div>
                    <div class="flex justify-between w-full text-slate-400 pl-4">
                        <span>{i18n.lang === "zh" ? "节省费用:" : "Profit:"}</span>
                        <span class="text-slate-600 dark:text-slate-300 font-medium">${(overview.exact_profit_quota / 1000).toFixed(2)}</span>
                    </div>
                </div>

                <!-- Semantic Cache Stats -->
                <div class="space-y-1">
                    <div class="flex justify-between w-full font-semibold text-emerald-600 dark:text-emerald-400">
                        <span>{i18n.lang === "zh" ? "🍃 语义缓存:" : "🍃 Semantic Cache:"}</span>
                        <span>{formatNumber(overview.semantic_hits)} hit</span>
                    </div>
                    <div class="flex justify-between w-full text-slate-400 pl-4">
                        <span>{i18n.lang === "zh" ? "节省费用:" : "Profit:"}</span>
                        <span class="text-slate-600 dark:text-slate-300 font-medium">${(overview.semantic_profit_quota / 1000).toFixed(2)}</span>
                    </div>
                </div>

                <div class="flex justify-between w-full mt-1.5 pt-1.5 border-t border-slate-50 dark:border-slate-800/50">
                    <span class="text-slate-400 text-[10px]">{i18n.lang === "zh" ? "库容 (E/S):" : "Storage (E/S):"}</span>
                    <span class="text-slate-500 text-[10px] font-medium tabular-nums">
                        {overview.exact_cache_count} / {overview.semantic_cache_count} rec
                    </span>
                </div>
            </div>
        </div>

        <!-- 5. Avg Latency -->
        <div
            class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm"
        >
            <h3
                class="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2"
            >
                {i18n.lang === "zh" ? i18n.t.dashboard.avgLatency : "Avg Latency"}
            </h3>
            <div
                class="text-3xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight"
            >
                {overview.avg_latency || 0} <span class="text-sm font-medium text-slate-400">{i18n.lang === "zh" ? i18n.t.dashboard.ms : "ms"}</span>
            </div>
            <div class="mt-4 h-1 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div 
                    class="h-full bg-indigo-500 rounded-full transition-all duration-1000" 
                    style="width: {Math.min((overview.avg_latency / 2000) * 100, 100)}%"
                ></div>
            </div>
        </div>
    </div>

    <!-- Charts Row -->
    <div class="grid gap-6 lg:grid-cols-2 mt-8">
        <!-- Traffic Trend -->
        <div class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-6 backdrop-blur-xl">
            <h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-6">
                {i18n.lang === "zh" ? i18n.t.dashboard.trafficTrend : "Traffic Trend"}
            </h3>
            <div class="h-48 w-full relative group">
                {#if timeSeries?.length > 1}
                    {@const max = Math.max(...timeSeries.map(p => p.requests)) * 1.2 || 1}
                    {@const points = timeSeries.map((p, i) => `${(i / (timeSeries.length - 1)) * 100},${100 - (p.requests / max) * 100}`).join(' ')}
                    <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="rgb(99, 102, 241)" stop-opacity="0.2" />
                                <stop offset="100%" stop-color="rgb(99, 102, 241)" stop-opacity="0" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M 0,100 L {points} L 100,100 Z"
                            fill="url(#trafficGrad)"
                            class="transition-all duration-1000"
                        />
                        <polyline
                            fill="none"
                            stroke="rgb(99, 102, 241)"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            points={points}
                            class="transition-all duration-1000"
                        />
                    </svg>
                {:else}
                    <div class="flex items-center justify-center h-full text-slate-400 text-xs italic">
                        {i18n.lang === "zh" ? i18n.t.common.loading : "Loading..."}
                    </div>
                {/if}
            </div>
        </div>

        <!-- Cost Trend -->
        <div class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-6 backdrop-blur-xl">
            <h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-6">
                {i18n.lang === "zh" ? i18n.t.dashboard.costTrend : "Cost Trend"}
            </h3>
            <div class="h-48 w-full relative">
                {#if timeSeries?.length > 1}
                    {@const max = Math.max(...timeSeries.map(p => Number(p.cost))) * 1.2 || 1}
                    {@const points = timeSeries.map((p, i) => `${(i / (timeSeries.length - 1)) * 100},${100 - (Number(p.cost) / max) * 100}`).join(' ')}
                    <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="rgb(249, 115, 22)" stop-opacity="0.2" />
                                <stop offset="100%" stop-color="rgb(249, 115, 22)" stop-opacity="0" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M 0,100 L {points} L 100,100 Z"
                            fill="url(#costGrad)"
                            class="transition-all duration-1000"
                        />
                        <polyline
                            fill="none"
                            stroke="rgb(249, 115, 22)"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            points={points}
                            class="transition-all duration-1000"
                        />
                    </svg>
                {:else}
                    <div class="flex items-center justify-center h-full text-slate-400 text-xs italic">
                        {i18n.lang === "zh" ? i18n.t.common.loading : "Loading..."}
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Granular Model Breakdown (Dual Layout) -->
    <div
        class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm backdrop-blur-xl overflow-hidden mt-8"
    >
        <div
            class="p-4 border-b border-slate-200/60 dark:border-slate-800/60 font-semibold text-slate-800 dark:text-slate-100"
        >
            {i18n.lang === "zh" ? "按模型" : "By Model"}
        </div>

        <div
            class="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/60 dark:divide-slate-800/60 min-h-[500px]"
        >
            <!-- Left Column: Channel / Key -->
            <div class="p-0">
                <div
                    class="p-4 bg-slate-50/50 dark:bg-slate-800/30 font-medium text-sm text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-100 dark:border-slate-800/50"
                >
                    {i18n.lang === "zh" ? "密钥 (渠道)" : "Keys (Channels)"}
                </div>
                <div class="divide-y divide-slate-100 dark:divide-slate-800">
                    {#each modelsChannel as model}
                        <div
                            class="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex justify-between items-center group"
                        >
                            <div class="space-y-1">
                                <h4
                                    class="font-bold text-slate-900 dark:text-slate-100 text-sm"
                                >
                                    {model.model_name}
                                </h4>
                                <div
                                    class="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-medium tabular-nums"
                                >
                                    <span
                                        class="flex items-center gap-1"
                                        title="Requests"
                                    >
                                        <TrendingUp
                                            class="w-3.5 h-3.5 text-slate-400"
                                        />
                                        {formatNumber(model.requests)}
                                    </span>
                                    <span
                                        class="flex items-center gap-1 text-slate-400"
                                        title="Tokens"
                                    >
                                        # {formatTokens(model.tokens)}
                                    </span>
                                    <span
                                        class="flex items-center gap-1 font-semibold {model.success_rate >=
                                        90
                                            ? 'text-emerald-500'
                                            : model.success_rate >= 70
                                              ? 'text-amber-500'
                                              : 'text-rose-500'}"
                                    >
                                        <Target class="w-3 h-3" />
                                        {model.success_rate}%
                                    </span>
                                </div>
                            </div>
                            <div class="text-right">
                                <div
                                    class="font-bold text-slate-900 dark:text-slate-100 text-sm tabular-nums"
                                >
                                    ${(model.cost / 1000).toFixed(2)}
                                </div>
                                <div
                                    class="text-xs font-semibold text-slate-400 tabular-nums"
                                >
                                    ({model.cost_percentage}%)
                                </div>
                            </div>
                        </div>
                    {:else}
                        {#if !isLoading}
                            <div class="p-8 text-center text-sm text-slate-500">
                                {i18n.lang === "zh" ? "暂无数据" : "No Data"}
                            </div>
                        {/if}
                    {/each}
                </div>
            </div>

            <!-- Right Column: User -->
            <div class="p-0">
                <div
                    class="p-4 bg-slate-50/50 dark:bg-slate-800/30 font-medium text-sm text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-100 dark:border-slate-800/50"
                >
                    {i18n.lang === "zh" ? "用户" : "Users"}
                </div>
                <div class="divide-y divide-slate-100 dark:divide-slate-800">
                    {#each modelsUser as model}
                        <div
                            class="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex justify-between items-center group"
                        >
                            <div class="space-y-1">
                                <h4
                                    class="font-bold text-slate-900 dark:text-slate-100 text-sm"
                                >
                                    {model.model_name}
                                </h4>
                                <div
                                    class="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-medium tabular-nums"
                                >
                                    <span
                                        class="flex items-center gap-1"
                                        title="Requests"
                                    >
                                        <Activity
                                            class="w-3.5 h-3.5 text-slate-400"
                                        />
                                        {formatNumber(model.requests)}
                                    </span>
                                    <span
                                        class="flex items-center gap-1 text-slate-400"
                                        title="Tokens"
                                    >
                                        # {formatTokens(model.tokens)}
                                    </span>
                                    <span
                                        class="flex items-center gap-1 font-semibold {model.success_rate >=
                                        90
                                            ? 'text-emerald-500'
                                            : model.success_rate >= 70
                                              ? 'text-amber-500'
                                              : 'text-rose-500'}"
                                    >
                                        <Target class="w-3 h-3" />
                                        {model.success_rate}%
                                    </span>
                                </div>
                            </div>
                            <div class="text-right">
                                <div
                                    class="font-bold text-slate-900 dark:text-slate-100 text-sm tabular-nums"
                                >
                                    ${(model.cost / 1000).toFixed(2)}
                                </div>
                                <div
                                    class="text-xs font-semibold text-slate-400 tabular-nums"
                                >
                                    ({model.cost_percentage}%)
                                </div>
                            </div>
                        </div>
                    {:else}
                        {#if !isLoading}
                            <div class="p-8 text-center text-sm text-slate-500">
                                {i18n.lang === "zh" ? "暂无数据" : "No Data"}
                            </div>
                        {/if}
                    {/each}
                </div>
            </div>
        </div>
    </div>
</div>
