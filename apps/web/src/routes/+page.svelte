<script lang="ts">
    import { Activity, CreditCard, DollarSign, Users } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n";
    import { onMount } from "svelte";

    // Responsive state variables
    let stats = $state<any>(null);
    let isLoading = $state(true);

    onMount(async () => {
        try {
            // Fetch aggregated stats from backend
            stats = await apiFetch<any>("/dashboard/stats");
        } catch (e: any) {
            console.error("[Dashboard] Load Failed", e.message);
        } finally {
            isLoading = false;
        }
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
                {i18n.t.common.loading}
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
            <div
                class="p-6 pt-4 border-t border-slate-100 dark:border-slate-800 mt-4 space-y-4"
            >
                {#each Array(4) as _, i}
                    <div class="flex items-center">
                        <div class="ml-4 space-y-1">
                            <p
                                class="text-sm font-medium leading-none text-rose-500"
                            >
                                {i18n.lang === "zh"
                                    ? "API Key 失效"
                                    : "Invalid API Key"}
                            </p>
                            <p class="text-sm text-slate-500">
                                IP: 192.168.1.{i + 10}
                            </p>
                        </div>
                        <div class="ml-auto font-medium text-sm text-slate-500">
                            + {i * 12 + 5}
                            {i18n.lang === "zh" ? "拦截" : "Blocked"}
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>
