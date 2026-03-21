<script lang="ts">
    import { ShoppingBag, Box, Clock, ShieldCheck } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    


    let packages = $state<any[]>([]);
    let subscriptions = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    async function loadData() {
        isLoading = true;
        try {
            const [pkgs, subs] = await Promise.all([
                apiFetch<any[]>("/user/packages"),
                apiFetch<any[]>("/user/subscriptions")
            ]);
            packages = pkgs;
            subscriptions = subs;
        } catch (err: unknown) {
            errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : (i18n.lang === "zh" ? "加载数据失败" : "Failed to load data");
        } finally {
            isLoading = false;
        }
    }

    $effect(() => { loadData(); });

    const renderModels = (models: any) => {
        if (!models) return "";
        const arr = Array.isArray(models) ? models : (typeof models === 'string' ? models.split(',') : []);
        return arr.map((m: string) => `<span class="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-indigo-50 dark:bg-indigo-500/10 text-[11px] text-indigo-700 dark:text-indigo-300 font-mono tracking-tighter shadow-sm border border-indigo-100 dark:border-indigo-500/20">${m.trim()}</span>`).join("");
    };

    const isExpired = (endTime: string) => new Date(endTime) < new Date();
</script>

<div class="flex-1 space-y-8 text-left max-w-5xl mx-auto w-full">
    <div>
        <h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">
            <Box class="w-6 h-6 text-indigo-500" />
            {i18n.lang === "zh" ? "我的订阅" : "My Subscriptions"}
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {i18n.lang === "zh"
                ? "查看您已购买的模型授权套餐及过期时间。支持在套餐有效期内无限次或依套餐限制调用覆盖的模型。"
                : "View your active model access packages and their expiration dates."}
        </p>
    </div>

    {#if isLoading}
        <div class="flex justify-center items-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
    {:else if errorMsg}
        <div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400 flex items-center gap-2">
            <ShieldCheck class="w-5 h-5" />
            {errorMsg}
        </div>
    {:else}
        <!-- Active Subscriptions -->
        <h3 class="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2">
            {i18n.lang === "zh" ? "当前生效中的套餐" : "Active Plans"}
        </h3>
        
        {#if subscriptions.length === 0}
            <div class="text-center py-8 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                <Box class="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
                <p class="text-slate-500 dark:text-slate-400 text-sm">{i18n.lang === "zh" ? "您目前没有任何可用或生效的套餐。" : "You do not have any active packages."}</p>
            </div>
        {:else}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                {#each subscriptions as sub}
                    {@const expired = isExpired(sub.end_time)}
                    <div class={`rounded-xl border p-5 transition-all ${expired ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 opacity-70' : 'bg-white dark:bg-slate-950 border-indigo-100 dark:border-indigo-500/20 shadow-sm relative overflow-hidden'}`}>
                        {#if !expired}
                        <div class="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                        {/if}
                        <div class="flex justify-between items-start mb-4">
                            <div>
                                <h4 class="font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                                    {sub.package_name}
                                    {#if expired}
                                        <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{i18n.lang === 'zh' ? '已过期' : 'Expired'}</span>
                                    {:else}
                                        <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">{i18n.lang === 'zh' ? '生效中' : 'Active'}</span>
                                    {/if}
                                </h4>
                            </div>
                        </div>
                        
                        <div class="mb-4">
                            <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">{i18n.lang === 'zh' ? '支持模型包含' : 'Included Models'}</p>
                            <div class="flex flex-wrap">
                                {@html renderModels(sub.models)}
                            </div>
                        </div>

                        <div class="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <div class="flex items-center gap-1.5">
                                <Clock class="w-3.5 h-3.5" />
                                <span>{new Date(sub.start_time).toLocaleDateString()} -> {new Date(sub.end_time).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- Available Packages for Purchase -->
        <h3 class="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mt-12">
            {i18n.lang === "zh" ? "探索可用套餐" : "Explore Packages"}
        </h3>
        
        {#if packages.length === 0}
            <div class="text-center py-8 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <p class="text-slate-500 dark:text-slate-400 text-sm">{i18n.lang === "zh" ? "系统暂未上架任何公开销售的套餐包。" : "No public packages are available at the moment."}</p>
            </div>
        {:else}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                {#each packages as pkg}
                    <div class="flex flex-col bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
                        <div class="p-6 flex-1">
                            <h4 class="text-xl font-bold text-slate-900 dark:text-white mb-2">{pkg.name}</h4>
                            {#if pkg.description}
                                <p class="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-4 h-10">{pkg.description}</p>
                            {/if}
                            <div class="mb-6 flex items-baseline text-slate-900 dark:text-white">
                                <span class="text-3xl font-extrabold tracking-tight">${Number(pkg.price).toFixed(2)}</span>
                                <span class="ml-1 text-sm font-medium text-slate-500 dark:text-slate-400">/ {pkg.duration_days} {i18n.lang === 'zh' ? '天' : 'days'}</span>
                            </div>
                            
                            <div class="space-y-3 mt-6">
                                <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{i18n.lang === 'zh' ? '免额度任用模型 (遵循套餐限流)' : 'Zero-quota Usage On'}</p>
                                <div class="flex flex-wrap">
                                    {@html renderModels(pkg.models)}
                                </div>
                            </div>
                        </div>
                        <div class="p-6 pt-0 bg-slate-50/50 dark:bg-slate-900/30">
                            <button disabled class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-colors opacity-60 cursor-not-allowed text-center">
                                {i18n.lang === 'zh' ? '请联系管理员开通' : 'Contact Admin to Purchase'}
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</div>
