<script lang="ts">
    import { CreditCard, History, WalletCards, Activity, TrendingUp, Target, Clock } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    
    import { session } from "$lib/session.svelte";

    interface UserStats {
        overview: {
            total_requests: number;
            total_cost: number;
            total_prompt_tokens: number;
            total_completion_tokens: number;
            avg_latency: number;
        };
        models: Record<string, any>[];
        time_series: Record<string, any>[];
    }

    interface UserInfo {
        id: number;
        username: string;
        quota: number;
        used_quota: number;
        role: number;
        group: string;
    }

    interface LogEntry {
        modelName: string;
        createdAt: string;
        promptTokens: number;
        completionTokens: number;
        quotaCost: number;
    }

    let userInfo = $state<UserInfo | null>(null);
    let logs = $state<LogEntry[]>([]);
    let stats = $state<UserStats | null>(null);
    let activePeriod = $state("today");
    let isLoading = $state(true);
    let isRedeeming = $state(false);
    let topupCode = $state("");
    let message = $state({ type: "", text: "" });

    const periods = [
        { id: "today", label: "今天", labelEn: "Today" },
        { id: "yesterday", label: "昨天", labelEn: "Yesterday" },
        { id: "7d", label: "近7天", labelEn: "7 Days" },
        { id: "30d", label: "近30天", labelEn: "30 Days" },
    ];

    async function loadData() {
        isLoading = true;
        try {
            const [userData, logsData, statsData] = await Promise.all([
                apiFetch<UserInfo>("/user/info"),
                apiFetch<{data?: any[], [key: string]: any}>("/user/logs?limit=5"),
                apiFetch<UserStats>(`/user/dashboard/stats?period=${activePeriod}`),
            ]);
            userInfo = userData;
            logs = (logsData.data as LogEntry[]) || (logsData as unknown as LogEntry[]);
            stats = statsData;
        } catch (err: unknown) {
            console.error(err);
        } finally {
            isLoading = false;
        }
    }

    $effect(() => {
        loadData();
    });

    $effect(() => {
        if (activePeriod) loadData();
    });

    async function handleTopup(e: Event) {
        e.preventDefault();
        if (!topupCode.trim()) return;

        isRedeeming = true;
        message = { type: "", text: "" };

        try {
            const res = await apiFetch<{success: boolean, balance: number, addedQuota: number}>("/redemptions/redeem", {
                method: "POST",
                body: JSON.stringify({ key: topupCode.trim() }),
            });
            message = {
                type: "success",
                text: `${i18n.lang === "zh" ? "充值成功！新增额度：" : "Top-up successful! Added: "}${session.currency === "RMB" ? "¥" : "$"}${((res.addedQuota / session.quotaPerUnit) * (session.currency === "RMB" ? session.exchangeRate : 1)).toFixed(2)}`,
            };
            topupCode = "";
            await loadData();
        } catch (err: unknown) {
            message = {
                type: "error",
                text: err instanceof Error ? err instanceof Error ? err.message : String(err) : i18n.t.common.failed,
            };
        } finally {
            isRedeeming = false;
        }
    }

    function formatNumber(num: number) {
        return new Intl.NumberFormat("en-US").format(num);
    }
</script>

<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full">
    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <WalletCards class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "个人工作台" : "User Dashboard"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh" ? "查看您的使用统计与账户余额" : "Monitor your usage and account balance"}
            </p>
        </div>

        <div class="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl w-fit">
            {#each periods as period}
                <button
                    onclick={() => (activePeriod = period.id)}
                    class="px-4 py-1.5 text-xs font-semibold rounded-lg transition-all {activePeriod === period.id
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'}"
                >
                    {i18n.lang === "zh" ? period.label : period.labelEn}
                </button>
            {/each}
        </div>
    </div>

    <!-- Top Row: Balance & Overview -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Balance Card -->
        <div class="lg:col-span-1 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl p-6 text-white shadow-xl shadow-indigo-500/20 relative overflow-hidden h-fit">
            <div class="absolute top-0 right-0 p-4 opacity-10">
                <CreditCard class="w-24 h-24" />
            </div>
            <h3 class="text-indigo-100 font-medium text-sm opacity-80">
                {i18n.lang === "zh" ? "当前可用余额" : "Available Balance"}
            </h3>
            <div class="mt-2 flex items-baseline gap-2">
                <span class="text-4xl font-bold tracking-tight">
                    {session.currency === "RMB" ? "¥" : "$"}{(
                        ((userInfo?.quota || 0) / session.quotaPerUnit) *
                        (session.currency === "RMB" ? session.exchangeRate : 1)
                    ).toFixed(2)}
                </span>
                <span class="text-indigo-200 text-sm font-medium">{session.currency}</span>
            </div>
            
            <div class="mt-8 pt-6 border-t border-white/10">
                <form onsubmit={handleTopup} class="space-y-3">
                    <div class="flex gap-2">
                        <input
                            bind:value={topupCode}
                            placeholder={i18n.lang === 'zh' ? '输入兑换码' : 'Redeem Code'}
                            class="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-sm placeholder:text-indigo-200/50 outline-none focus:bg-white/20 transition-all"
                        />
                        <button
                            type="submit"
                            disabled={isRedeeming || !topupCode.trim()}
                            class="px-4 py-2 bg-white text-indigo-600 font-bold rounded-xl text-xs hover:bg-indigo-50 disabled:opacity-50 transition-all"
                        >
                            {isRedeeming ? "..." : (i18n.lang === "zh" ? "兑换" : "Redeem")}
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Quick Stats Cards -->
        <div class="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4">
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">
                    <Activity class="w-4 h-4" />
                    <span class="text-xs font-medium">{i18n.lang === 'zh' ? '请求总数' : 'Requests'}</span>
                </div>
                <div class="text-2xl font-bold tabular-nums">{formatNumber(stats?.overview.total_requests || 0)}</div>
            </div>

            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">
                    <TrendingUp class="w-4 h-4" />
                    <span class="text-xs font-medium">{i18n.lang === 'zh' ? '总消费' : 'Total Cost'}</span>
                </div>
                <div class="text-2xl font-bold tabular-nums">
                    {session.currency === "RMB" ? "¥" : "$"}{(
                        ((stats?.overview.total_cost || 0) / session.quotaPerUnit) *
                        (session.currency === "RMB" ? session.exchangeRate : 1)
                    ).toFixed(4)}
                </div>
            </div>

            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">
                    <Clock class="w-4 h-4" />
                    <span class="text-xs font-medium">{i18n.t.dashboard.avgLatency}</span>
                </div>
                <div class="text-2xl font-bold tabular-nums">{stats?.overview.avg_latency || 0} <span class="text-xs text-slate-400">ms</span></div>
            </div>
        </div>
    </div>

    <!-- Charts Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Traffic trend -->
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
            <h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                <TrendingUp class="w-4 h-4 text-indigo-500" />
                {i18n.t.dashboard.trafficTrend}
            </h3>
            <div class="h-48 w-full relative">
                {#if stats && stats.time_series.length > 1}
                    {@const ts = stats.time_series}
                    {@const max = Math.max(...ts.map(p => p.requests)) * 1.2 || 1}
                    {@const pts = ts.map((p, i) => `${(i / (ts.length - 1)) * 100},${100 - (p.requests / max) * 100}`).join(' ')}
                    <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
                         <defs>
                            <linearGradient id="userTrafficGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="rgb(99, 102, 241)" stop-opacity="0.2" />
                                <stop offset="100%" stop-color="rgb(99, 102, 241)" stop-opacity="0" />
                            </linearGradient>
                        </defs>
                        <path d="M 0,100 L {pts} L 100,100 Z" fill="url(#userTrafficGrad)" />
                        <polyline fill="none" stroke="rgb(99, 102, 241)" stroke-width="2" points={pts} />
                    </svg>
                {:else}
                    <div class="h-full flex items-center justify-center text-slate-400 text-xs italic">{i18n.t.common.noData}</div>
                {/if}
            </div>
        </div>

        <!-- Model distribution -->
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
            <h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                <Target class="w-4 h-4 text-rose-500" />
                {i18n.t.dashboard.modelDistribution}
            </h3>
            <div class="space-y-4">
                {#if stats && stats.models.length > 0}
                    {#each stats.models as model}
                        <div class="space-y-1.5">
                            <div class="flex justify-between text-xs">
                                <span class="font-medium text-slate-700 dark:text-slate-300">{model.model_name}</span>
                                <span class="text-slate-500">{formatNumber(model.requests)} {i18n.t.dashboard.requests}</span>
                            </div>
                            <div class="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div class="h-full bg-indigo-500 rounded-full" style="width: {(model.requests / stats.overview.total_requests) * 100}%"></div>
                            </div>
                        </div>
                    {/each}
                {:else}
                    <div class="h-32 flex items-center justify-center text-slate-400 text-xs italic">{i18n.t.common.noData}</div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Recent History -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        <div class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h3 class="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <History class="w-4 h-4 text-slate-400" />
                {i18n.lang === 'zh' ? '最近使用记录' : 'Recent usage'}
            </h3>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
                <thead class="text-[10px] text-slate-500 bg-slate-50/50 dark:bg-slate-900/50 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                    <tr>
                        <th class="px-6 py-4 font-semibold">Model</th>
                        <th class="px-6 py-4 font-semibold text-center">Tokens</th>
                        <th class="px-6 py-4 font-semibold text-right">Cost</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                    {#each logs as log}
                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <td class="px-6 py-4">
                                <div class="font-medium text-slate-900 dark:text-slate-200">{log.modelName}</div>
                                <div class="text-[10px] text-slate-400 mt-0.5">{new Date(log.createdAt).toLocaleString()}</div>
                            </td>
                            <td class="px-6 py-4 text-center text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {log.promptTokens + log.completionTokens}
                            </td>
                            <td class="px-6 py-4 text-right">
                                <span class="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                    {session.currency === "RMB" ? "¥" : "$"}{(
                                        (log.quotaCost / session.quotaPerUnit) * (session.currency === "RMB" ? session.exchangeRate : 1)
                                    ).toFixed(4)}
                                </span>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    </div>
</div>
