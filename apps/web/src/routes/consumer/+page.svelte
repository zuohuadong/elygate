<script lang="ts">
    import { CreditCard, History, KeyRound, WalletCards } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";

    let userInfo = $state<any>(null);
    let logs = $state<any[]>([]);
    let isLoading = $state(true);
    let isRedeeming = $state(false);
    let topupCode = $state("");
    let message = $state({ type: "", text: "" });

    async function loadData() {
        isLoading = true;
        try {
            const data = await apiFetch<any>("/auth/me");
            userInfo = data;

            const logsData = await apiFetch<any[]>("/auth/logs");
            logs = logsData.slice(0, 10);
        } catch (err: any) {
            console.error(err);
        } finally {
            isLoading = false;
        }
    }

    onMount(loadData);

    async function handleTopup(e: Event) {
        e.preventDefault();
        if (!topupCode.trim()) return;

        isRedeeming = true;
        message = { type: "", text: "" };

        try {
            const res = await apiFetch<any>("/redemptions/redeem", {
                method: "POST",
                body: JSON.stringify({ key: topupCode.trim() }),
            });
            message = {
                type: "success",
                text: `${i18n.lang === "zh" ? "充值成功！新增额度：" : "Top-up successful! Added: "}$${(res.addedQuota / 1000).toFixed(2)}`,
            };
            topupCode = "";
            await loadData(); // Refresh balance
        } catch (err: any) {
            message = {
                type: "error",
                text: err.message || i18n.t.common.failed,
            };
        } finally {
            isRedeeming = false;
        }
    }
</script>

<div class="flex-1 space-y-6 max-w-5xl mx-auto">
    <div class="flex items-center justify-between">
        <div>
            <h2
                class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"
            >
                <WalletCards class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "我的钱包" : "My Wallet"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "管理您的额度与API凭证"
                    : "Manage your quota and API credentials"}
            </p>
        </div>
    </div>

    <!-- Balance & Topup Card -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Balance Info -->
        <div
            class="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 shadow-lg shadow-indigo-500/20 text-white relative overflow-hidden"
        >
            <div class="absolute top-0 right-0 p-4 opacity-20">
                <CreditCard class="w-24 h-24" />
            </div>

            <h3 class="text-indigo-100 font-medium text-sm">
                {i18n.lang === "zh" ? "当前可用余额" : "Available Balance"}
            </h3>
            <div class="mt-2 flex items-baseline gap-2">
                <span class="text-4xl font-bold tracking-tight">
                    ${((userInfo?.quota || 0) / 1000).toFixed(2)}
                </span>
                <span class="text-indigo-200 text-sm">USD</span>
            </div>

            <div class="mt-8 grid grid-cols-2 gap-4">
                <div>
                    <p class="text-indigo-200 text-xs mb-1">
                        {i18n.lang === "zh" ? "总消费" : "Total Spent"}
                    </p>
                    <p class="font-medium">
                        $${((userInfo?.usedQuota || 0) / 1000).toFixed(2)}
                    </p>
                </div>
                <div>
                    <p class="text-indigo-200 text-xs mb-1">
                        {i18n.lang === "zh" ? "用户组" : "User Group"}
                    </p>
                    <p class="font-medium capitalize">
                        {userInfo?.group || "Default"}
                    </p>
                </div>
            </div>
        </div>

        <!-- Topup Form -->
        <div
            class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-center"
        >
            <h3
                class="text-lg font-semibold text-slate-900 dark:text-white mb-4"
            >
                {i18n.lang === "zh" ? "兑换额度" : "Redeem Quota"}
            </h3>

            <form onsubmit={handleTopup} class="space-y-4">
                <div class="space-y-2">
                    <label
                        for="topupCode"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                    >
                        {i18n.lang === "zh"
                            ? "输入兑换码"
                            : "Enter Redemption Code"}
                    </label>
                    <div class="flex gap-3">
                        <input
                            id="topupCode"
                            bind:value={topupCode}
                            placeholder="elygate-..."
                            class="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <button
                            type="submit"
                            disabled={isRedeeming || !topupCode.trim()}
                            class="px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-all"
                        >
                            {#if isRedeeming}
                                <div
                                    class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                                ></div>
                            {:else}
                                {i18n.lang === "zh" ? "兑换" : "Redeem"}
                            {/if}
                        </button>
                    </div>
                </div>

                {#if message.text}
                    <div
                        class={`p-3 text-sm rounded-lg border ${message.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-800/50" : "bg-rose-50 text-rose-800 border-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-800/50"}`}
                    >
                        {message.text}
                    </div>
                {/if}
            </form>
        </div>
    </div>

    <!-- Recent Logs -->
    <div
        class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
    >
        <div
            class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2"
        >
            <History class="w-5 h-5 text-slate-400" />
            <h3 class="font-semibold text-slate-900 dark:text-white">
                {i18n.lang === "zh" ? "最近请求记录" : "Recent API Logs"}
            </h3>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
                <thead
                    class="text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-900/50 uppercase border-b border-slate-100 dark:border-slate-800"
                >
                    <tr>
                        <th class="px-6 py-3 font-medium">Model</th>
                        <th class="px-6 py-3 font-medium">Tokens (P+C)</th>
                        <th class="px-6 py-3 font-medium">Cost</th>
                        <th class="px-6 py-3 font-medium">Time</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                    {#if logs.length === 0}
                        <tr>
                            <td
                                colspan="4"
                                class="px-6 py-8 text-center text-slate-400"
                            >
                                No recent activity
                            </td>
                        </tr>
                    {:else}
                        {#each logs as log}
                            <tr
                                class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                            >
                                <td
                                    class="px-6 py-3 font-medium text-slate-900 dark:text-slate-200 whitespace-nowrap"
                                >
                                    {log.modelName}
                                </td>
                                <td
                                    class="px-6 py-3 text-slate-600 dark:text-slate-400"
                                >
                                    {log.promptTokens} + {log.completionTokens}
                                </td>
                                <td
                                    class="px-6 py-3 font-medium text-emerald-600 dark:text-emerald-400"
                                >
                                    ${(log.quotaCost / 1000).toFixed(6)}
                                </td>
                                <td
                                    class="px-6 py-3 text-slate-500 dark:text-slate-400 text-xs"
                                >
                                    {new Date(log.createdAt).toLocaleString()}
                                </td>
                            </tr>
                        {/each}
                    {/if}
                </tbody>
            </table>
        </div>
    </div>
</div>
