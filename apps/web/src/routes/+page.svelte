<script lang="ts">
    import { Activity, CreditCard, DollarSign, Users } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";
    import type {
        DashboardStats,
        DashboardError,
        UsageTrend,
    } from "$lib/types";

    // Responsive state variables
    let stats = $state<DashboardStats | null>(null);
    let errorLogs = $state<DashboardError[]>([]);
    let trend = $state<UsageTrend[]>([]);
    let realtime = $state({ rpm: 0, tpm: 0 });
    let isLoading = $state(true);

    async function fetchRealtime() {
        try {
            const data = await apiFetch<any>("/stats/realtime");
            if (data && data.stats) {
                realtime = {
                    rpm: data.stats.requests_per_minute || 0,
                    tpm: data.stats.tokens_per_minute || 0,
                };
            }
        } catch (e) {}
    }

    onMount(() => {
        const loadInitialData = async () => {
            try {
                // Fetch aggregated stats, recent errors and trend info from backend
                const [statsRes, errorsRes, trendRes] = await Promise.all([
                    apiFetch<DashboardStats>("/admin/dashboard/stats"),
                    apiFetch<DashboardError[]>("/admin/dashboard/errors"),
                    apiFetch<UsageTrend[]>(
                        "/admin/stats/granular?group_by=day",
                    ),
                ]);
                stats = statsRes;
                errorLogs = errorsRes;
                trend = trendRes;
                fetchRealtime();
            } catch (e: any) {
                console.error("[Dashboard] Load Failed", e.message);
            } finally {
                isLoading = false;
            }
        };

        loadInitialData();
        const interval = setInterval(fetchRealtime, 5000);
        return () => clearInterval(interval);
    });

    // Derived metrics card data
    let metrics = $derived(
        stats
            ? [
                  {
                      title: i18n.t.dashboard.totalQuota,
                      value: `$ ${(Number(stats.usedQuota) / 1000).toFixed(2)}`,
                      change:
                          i18n.lang === "zh"
                              ? "历史总计消耗"
                              : "Total historical consumption",
                      icon: DollarSign,
                      trend: "neutral",
                  },
                  {
                      title: i18n.t.dashboard.todayTraffic,
                      value: `$ ${(Number(stats.todayQuota) / 1000).toFixed(4)}`,
                      change:
                          i18n.lang === "zh"
                              ? "今日累计下发"
                              : "Today's total usage",
                      icon: Activity,
                      trend: "up",
                  },
                  {
                      title: i18n.t.dashboard.totalUsers,
                      value: stats.totalUsers.toString(),
                      change:
                          i18n.lang === "zh" ? "活跃账户数" : "Active accounts",
                      icon: Users,
                      trend: "up",
                  },
                  {
                      title: i18n.t.dashboard.activeChannels,
                      value: stats.activeChannels.toString(),
                      change:
                          i18n.lang === "zh"
                              ? "负载均衡节点"
                              : "Load balancing nodes",
                      icon: CreditCard,
                      trend: "up",
                  },
              ]
            : [],
    );
</script>

<div class="flex-1 space-y-8">
    <div class="flex items-center justify-between space-y-2">
        <h2
            class="text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
        >
            {i18n.t.dashboard.title}
        </h2>
        <div class="flex items-center space-x-2">
            <button
                class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50 bg-slate-900 text-slate-50 hover:bg-slate-900/90 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-50/90 h-9 px-4 py-2 shadow"
            >
                {i18n.lang === "zh" ? "下载报告" : "Download Report"}
            </button>
        </div>
    </div>

    <!-- Overview Cards -->
    {#if isLoading}
        <div class="flex justify-center items-center py-12">
            <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"
            ></div>
        </div>
    {:else}
        <!-- Real-time Status Bar -->
        <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div
                class="col-span-full bg-indigo-50/50 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur-sm"
            >
                <div class="flex items-center gap-4">
                    <div class="relative">
                        <div
                            class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"
                        ></div>
                        <div
                            class="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 blur-[2px] opacity-50"
                        ></div>
                    </div>
                    <div>
                        <span
                            class="text-sm font-semibold text-slate-800 dark:text-slate-100"
                        >
                            {i18n.lang === "zh"
                                ? "系统实时监控"
                                : "System Real-time Monitor"}
                        </span>
                        <p
                            class="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5"
                        >
                            Status: Online & Healthy
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-12 self-end sm:self-center">
                    <div class="flex flex-col items-center sm:items-end">
                        <span
                            class="text-[10px] font-bold text-slate-400/80 uppercase tracking-tighter mb-1"
                        >
                            {i18n.lang === "zh" ? "请求 / 分钟" : "RPM"}
                        </span>
                        <div class="flex items-baseline gap-1">
                            <span
                                class="text-3xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums"
                            >
                                {realtime.rpm}
                            </span>
                        </div>
                    </div>
                    <div class="flex flex-col items-center sm:items-end">
                        <span
                            class="text-[10px] font-bold text-slate-400/80 uppercase tracking-tighter mb-1"
                        >
                            {i18n.lang === "zh" ? "令牌 / 分钟" : "TPM"}
                        </span>
                        <div class="flex items-baseline gap-1">
                            <span
                                class="text-3xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums"
                            >
                                {(realtime.tpm / 1000).toFixed(1)}
                            </span>
                            <span
                                class="text-xs font-bold text-indigo-600/50 dark:text-indigo-400/50"
                                >k</span
                            >
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {#each metrics as item}
                {@const Icon = item.icon}
                <div
                    class="rounded-xl border border-slate-200 bg-white/50 text-slate-950 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-50 transition-all hover:shadow-md"
                >
                    <div
                        class="p-6 flex flex-row items-center justify-between space-y-0 pb-2"
                    >
                        <h3
                            class="tracking-tight text-sm font-medium text-slate-500 dark:text-slate-400"
                        >
                            {item.title}
                        </h3>
                        <Icon
                            class="h-4 w-4 text-slate-400 dark:text-slate-500"
                        />
                    </div>
                    <div class="p-6 pt-0">
                        <div class="text-2xl font-bold">{item.value}</div>
                        <p
                            class="text-xs text-slate-500 dark:text-slate-400 mt-1"
                        >
                            <span
                                class={item.trend === "up"
                                    ? "text-emerald-500 font-medium"
                                    : ""}
                            >
                                {item.change}
                            </span>
                        </p>
                    </div>
                </div>
            {/each}
        </div>
    {/if}

    <!-- Chart & Monitor Placeholder -->
    <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <div
            class="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 col-span-4 transition-all"
        >
            <div class="p-6 pb-2">
                <h3 class="font-semibold leading-none tracking-tight">
                    {i18n.lang === "zh"
                        ? "消耗趋势 (Quota Usage)"
                        : "Quota Usage Trend"}
                </h3>
            </div>
            <div
                class="p-6 pt-4 h-[350px] flex items-center justify-center text-slate-500 border-t border-slate-100 dark:border-slate-800 mt-4"
            >
                {#if isLoading}
                    <div class="flex flex-col items-center gap-2">
                        <div
                            class="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"
                        ></div>
                        <span>{i18n.t.common.loading}</span>
                    </div>
                {:else if trend.length === 0}
                    <div
                        class="flex flex-col items-center gap-2 text-slate-400"
                    >
                        <Activity class="h-8 w-8 opacity-20" />
                        <span
                            >{i18n.lang === "zh"
                                ? "暂无消耗数据"
                                : "No usage data available"}</span
                        >
                    </div>
                {:else}
                    <div
                        class="w-full h-full flex items-end justify-between px-2 pb-4 gap-1"
                    >
                        {#each trend as day}
                            <div
                                class="bg-indigo-500/20 hover:bg-indigo-500/40 transition-all rounded-t-sm relative group flex-1"
                                style="height: {Math.max(
                                    10,
                                    Math.min(
                                        100,
                                        (Number(day.prompt_tokens) +
                                            Number(day.completion_tokens)) /
                                            10000,
                                    ),
                                )}%"
                            >
                                <div
                                    class="opacity-0 group-hover:opacity-100 absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] py-1 px-2 rounded whitespace-nowrap z-10 pointer-events-none transition-opacity shadow-lg"
                                >
                                    {day.label}: {(
                                        (Number(day.prompt_tokens) +
                                            Number(day.completion_tokens)) /
                                        1000
                                    ).toFixed(1)}k tokens
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>

        <div
            class="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 col-span-3 transition-all"
        >
            <div class="p-6 pb-2">
                <h3 class="font-semibold leading-none tracking-tight">
                    {i18n.lang === "zh" ? "异常监控" : "Anomaly Monitor"}
                </h3>
                <p class="text-sm text-slate-500 mt-1">
                    {i18n.lang === "zh"
                        ? "最近 24 小时出现的高频错误拦截"
                        : "High-frequency errors blocked in last 24h"}
                </p>
            </div>
            {#if errorLogs.length === 0}
                <div class="flex items-center justify-center py-8">
                    <p class="text-sm text-slate-400">
                        {i18n.lang === "zh"
                            ? "最近 24 小时未检测到异常"
                            : "No anomalies detected in last 24h"}
                    </p>
                </div>
            {:else}
                <div class="space-y-4">
                    {#each errorLogs as item}
                        <div class="flex items-center">
                            <div class="ml-4 space-y-1">
                                <p
                                    class="text-sm font-medium leading-none text-rose-500"
                                >
                                    {item.title || "Unknown Error"}
                                </p>
                                <p class="text-sm text-slate-500">
                                    IP: {item.ip || "Unknown"}
                                </p>
                            </div>
                            <div
                                class="ml-auto font-medium text-sm text-slate-500"
                            >
                                + {item.count}
                                {i18n.lang === "zh" ? "拦截" : "Blocked"}
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>
