<script lang="ts">
    import { DollarSign, Zap, Info, ChevronDown } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    

    interface ModelPricing {
        model: string;
        inputPrice: number;
        outputPrice: number;
        category: string;
    }

    let pricingData = $state<ModelPricing[]>([]);
    let isLoading = $state(true);
    let searchQuery = $state("");
    let selectedCategory = $state("all");
    let expandedCategories = $state<Set<string>>(new Set(["GPT", "Claude", "Gemini"]));

    const categories = [
        { id: "all", label: "全部", labelEn: "All" },
        { id: "GPT", label: "GPT", labelEn: "GPT" },
        { id: "Claude", label: "Claude", labelEn: "Claude" },
        { id: "Gemini", label: "Gemini", labelEn: "Gemini" },
        { id: "Qwen", label: "Qwen", labelEn: "Qwen" },
        { id: "DeepSeek", label: "DeepSeek", labelEn: "DeepSeek" },
    ];

    $effect(() => { (async () => {
        try {
            const data = await apiFetch<ModelPricing[]>("/models/pricing");
            pricingData = data || getDefaultPricing();
        } catch (e) {
            console.error("Failed to load pricing:", e);
            pricingData = getDefaultPricing();
        } finally {
            isLoading = false;
        }
    })(); });

    function getDefaultPricing(): ModelPricing[] {
        return [
            { model: "gpt-4o", inputPrice: 2.5, outputPrice: 10, category: "GPT" },
            { model: "gpt-4o-mini", inputPrice: 0.15, outputPrice: 0.6, category: "GPT" },
            { model: "gpt-4-turbo", inputPrice: 10, outputPrice: 30, category: "GPT" },
            { model: "gpt-3.5-turbo", inputPrice: 0.5, outputPrice: 1.5, category: "GPT" },
            { model: "claude-3-5-sonnet-20241022", inputPrice: 3, outputPrice: 15, category: "Claude" },
            { model: "claude-3-opus-20240229", inputPrice: 15, outputPrice: 75, category: "Claude" },
            { model: "claude-3-haiku-20240307", inputPrice: 0.25, outputPrice: 1.25, category: "Claude" },
            { model: "gemini-1.5-pro", inputPrice: 1.25, outputPrice: 5, category: "Gemini" },
            { model: "gemini-1.5-flash", inputPrice: 0.075, outputPrice: 0.3, category: "Gemini" },
            { model: "gemini-2.0-flash", inputPrice: 0.1, outputPrice: 0.4, category: "Gemini" },
            { model: "Qwen3.5-397B-A17B", inputPrice: 0.5, outputPrice: 2, category: "Qwen" },
            { model: "qwen-turbo", inputPrice: 0.05, outputPrice: 0.2, category: "Qwen" },
            { model: "qwen-plus", inputPrice: 0.4, outputPrice: 1.2, category: "Qwen" },
            { model: "deepseek-chat", inputPrice: 0.14, outputPrice: 0.28, category: "DeepSeek" },
            { model: "deepseek-reasoner", inputPrice: 0.55, outputPrice: 2.19, category: "DeepSeek" },
        ];
    }

    function formatPrice(price: number): string {
        if (price === 0) return "Free";
        if (price < 0.01) return `$${price.toFixed(4)}`;
        if (price < 1) return `$${price.toFixed(3)}`;
        return `$${price.toFixed(2)}`;
    }

    function toggleCategory(category: string) {
        const newExpanded = new Set(expandedCategories);
        if (newExpanded.has(category)) {
            newExpanded.delete(category);
        } else {
            newExpanded.add(category);
        }
        expandedCategories = newExpanded;
    }

    function getFilteredData(): ModelPricing[] {
        return pricingData.filter((item) => {
            const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
            const matchesSearch = !searchQuery || item.model.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesCategory && matchesSearch;
        });
    }

    function getGroupedData(): Record<string, ModelPricing[]> {
        const filtered = getFilteredData();
        const grouped: Record<string, ModelPricing[]> = {};
        for (const item of filtered) {
            if (!grouped[item.category]) {
                grouped[item.category] = [];
            }
            grouped[item.category].push(item);
        }
        return grouped;
    }
</script>

<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full">
    <!-- Header -->
    <div>
        <h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <DollarSign class="w-6 h-6 text-emerald-500" />
            {i18n.lang === "zh" ? "模型定价" : "Model Pricing"}
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {i18n.lang === "zh" ? "查看各模型的定价信息，价格单位为每百万 tokens" : "View pricing for all models. Prices are per million tokens."}
        </p>
    </div>

    <!-- Info Card -->
    <div class="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 text-white">
        <div class="flex items-start gap-4">
            <div class="p-3 bg-white/20 rounded-xl">
                <Zap class="w-6 h-6" />
            </div>
            <div>
                <h3 class="font-bold text-lg">
                    {i18n.lang === "zh" ? "按量计费，灵活高效" : "Pay as you go"}
                </h3>
                <p class="text-white/80 text-sm mt-1">
                    {i18n.lang === "zh" 
                        ? "只需为您实际使用的 tokens 付费，无最低消费要求。支持多种主流模型，价格透明。"
                        : "Only pay for the tokens you actually use. No minimum commitment. Support for multiple mainstream models with transparent pricing."}
                </p>
            </div>
        </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-col sm:flex-row gap-4">
        <div class="flex-1">
            <input
                type="text"
                bind:value={searchQuery}
                placeholder={i18n.lang === "zh" ? "搜索模型..." : "Search models..."}
                class="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
        </div>
        <div class="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
            {#each categories as category}
                <button
                    onclick={() => (selectedCategory = category.id)}
                    class="px-4 py-2 text-sm font-medium rounded-xl whitespace-nowrap transition {selectedCategory === category.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-indigo-300'}"
                >
                    {i18n.lang === "zh" ? category.label : category.labelEn}
                </button>
            {/each}
        </div>
    </div>

    <!-- Pricing Table -->
    <div class="space-y-4">
        {#if isLoading}
            <div class="flex items-center justify-center py-12">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        {:else if Object.keys(getGroupedData()).length === 0}
            <div class="text-center py-12 text-slate-500">
                {i18n.lang === "zh" ? "没有找到匹配的模型" : "No models found"}
            </div>
        {:else}
            {#each Object.entries(getGroupedData()) as [category, models]}
                <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                    <button
                        onclick={() => toggleCategory(category)}
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                                <span class="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                                    {category.charAt(0)}
                                </span>
                            </div>
                            <div class="text-left">
                                <h3 class="font-semibold text-slate-900 dark:text-white">{category}</h3>
                                <p class="text-xs text-slate-500">{models.length} {i18n.lang === "zh" ? "个模型" : "models"}</p>
                            </div>
                        </div>
                        <ChevronDown class="w-5 h-5 text-slate-400 transition-transform {expandedCategories.has(category) ? 'rotate-180' : ''}" />
                    </button>

                    {#if expandedCategories.has(category)}
                        <div class="border-t border-slate-200 dark:border-slate-800">
                            <table class="w-full">
                                <thead>
                                    <tr class="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                                        <th class="px-6 py-3 text-left font-medium">{i18n.lang === "zh" ? "模型" : "Model"}</th>
                                        <th class="px-6 py-3 text-right font-medium">
                                            {i18n.lang === "zh" ? "输入价格" : "Input Price"}
                                            <span class="text-[10px] text-slate-400 block">/1M tokens</span>
                                        </th>
                                        <th class="px-6 py-3 text-right font-medium">
                                            {i18n.lang === "zh" ? "输出价格" : "Output Price"}
                                            <span class="text-[10px] text-slate-400 block">/1M tokens</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                    {#each models as item}
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                                            <td class="px-6 py-4">
                                                <span class="font-mono text-sm text-slate-900 dark:text-white">{item.model}</span>
                                            </td>
                                            <td class="px-6 py-4 text-right">
                                                <span class="text-sm font-medium text-slate-900 dark:text-white">
                                                    {formatPrice(item.inputPrice)}
                                                </span>
                                            </td>
                                            <td class="px-6 py-4 text-right">
                                                <span class="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                                    {formatPrice(item.outputPrice)}
                                                </span>
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- Note -->
    <div class="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
        <Info class="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div class="text-sm text-amber-800 dark:text-amber-200">
            {i18n.lang === "zh" 
                ? "以上价格仅供参考，实际价格以系统配置为准。不同渠道可能有不同的定价策略。"
                : "Prices shown are for reference only. Actual prices may vary based on system configuration. Different channels may have different pricing strategies."}
        </div>
    </div>
</div>
