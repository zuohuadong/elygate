<script lang="ts">
    

    import { session } from "$lib/session.svelte";
    import { apiFetch } from "$lib/api";
    import {
        Save,
        AlertCircle,
        RefreshCw,
        Table,
        Settings2,
    } from "lucide-svelte";
    import { i18n } from "$lib/i18n/index.svelte";
    import { fade, slide } from "svelte/transition";

    let isLoading = $state(true);
    let isSaving = $state(false);
    let error: string | null = $state(null);
    let successMessage: string | null = $state(null);
    let isAdmin = $derived(session.role >= 10);
    let activeTab = $state<"list" | "config">("list");

    // Default configuration template structures
    let configs = $state({
        ModelRatio: '{\n  "gpt-3.5-turbo": 1,\n  "gpt-4": 15\n}',
        CompletionRatio: '{\n  "gpt-3.5-turbo": 1.33,\n  "gpt-4": 2\n}',
        GroupRatio: '{\n  "default": 1,\n  "vip": 0.8\n}',
        GroupModelRatio: '{\n  "vip": {\n    "gpt-4": 0.5\n  }\n}',
        FixedCostModels: '{\n  "dall-e-3": 100000,\n  "mj-imagine": 200000\n}',
    });

    const configDefinitions = [
        {
            key: "ModelRatio",
            title: i18n.t.pricing.modelRatio,
            desc: i18n.t.pricing.modelRatioDesc,
        },
        {
            key: "CompletionRatio",
            title: i18n.t.pricing.completionRatio,
            desc: i18n.t.pricing.completionRatioDesc,
        },
        {
            key: "GroupRatio",
            title: i18n.t.pricing.groupRatio,
            desc: i18n.t.pricing.groupRatioDesc,
        },
        {
            key: "GroupModelRatio",
            title: i18n.t.pricing.groupModelRatio,
            desc: i18n.t.pricing.groupModelRatioDesc,
        },
        {
            key: "FixedCostModels",
            title: i18n.t.pricing.fixedCostModels,
            desc: i18n.t.pricing.fixedCostModelsDesc,
        },
    ] as const;

    type ConfigKey = keyof typeof configs;

    // Derived list for Pricing Table
    let pricingList = $derived.by(() => {
        try {
            const mRatios = JSON.parse(configs.ModelRatio);
            const cRatios = JSON.parse(configs.CompletionRatio);
            const fModels = JSON.parse(configs.FixedCostModels);

            const list: Record<string, unknown>[] = [];

            // 1. Handle Token-based models
            Object.keys(mRatios).forEach((model) => {
                const ratio = mRatios[model];
                const compRatio = cRatios[model] || 1;
                list.push({
                    model,
                    type: "Chat / Text",
                    // The ratio is directly the price per 1M tokens
                    inputPrice: ratio.toFixed(2),
                    outputPrice: (ratio * compRatio).toFixed(2),
                    fixedPrice: "-",
                });
            });

            // 2. Handle Fixed Cost models
            Object.keys(fModels).forEach((model) => {
                const cost = fModels[model];
                list.push({
                    model,
                    type: "Fixed / Image",
                    inputPrice: "-",
                    outputPrice: "-",
                    fixedPrice: `$ ${(cost / 1000000).toFixed(4)}`,
                });
            });

            return list;
        } catch (e) {
            return [];
        }
    });

    async function loadConfig() {
        isLoading = true;
        error = null;
        successMessage = null;
        try {
            const data =
                await apiFetch<Record<string, string>>("/payment/options");

            // Re-map actual configs, safely formatting valid JSON keys
            for (const c of configDefinitions) {
                if (data[c.key]) {
                    try {
                        // Prettify the retrieved JSON
                        const parsed = JSON.parse(data[c.key]);
                        configs[c.key as ConfigKey] = JSON.stringify(
                            parsed,
                            null,
                            2,
                        );
                    } catch (e) {
                        // If it's malformed in DB, just dump the raw string
                        configs[c.key as ConfigKey] = data[c.key];
                    }
                }
            }
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : String(err) ||
                (i18n.lang === "zh"
                    ? "加载计费配置失败"
                    : "Failed to load pricing options");
        } finally {
            isLoading = false;
        }
    }

    async function saveConfig() {
        isSaving = true;
        error = null;
        successMessage = null;

        const payload: Record<string, string> = {};

        // Validate JSON before sending
        for (const c of configDefinitions) {
            const raw = configs[c.key as ConfigKey].trim();
            if (!raw) continue;

            try {
                // Must be valid JSON
                const parsed = JSON.parse(raw);
                payload[c.key] = JSON.stringify(parsed);
            } catch (err: unknown) {
                error =
                    (i18n.lang === "zh"
                        ? `${c.title} JSON 格式错误: `
                        : `Invalid JSON in ${c.title}: `) + err instanceof Error ? err.message : String(err);
                isSaving = false;
                return;
            }
        }

        try {
            await apiFetch("/admin/options", {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            successMessage =
                i18n.lang === "zh"
                    ? "计费倍率保存成功！"
                    : "Pricing ratios saved successfully!";
            setTimeout(() => (successMessage = null), 3000);
        } catch (err: unknown) {
            error =
                err instanceof Error ? err.message : String(err) ||
                (i18n.lang === "zh"
                    ? "保存配置失败"
                    : "Failed to save options");
        } finally {
            isSaving = false;
        }
    }

    $effect(() => {
        loadConfig();
    });
</script>

<svelte:head>
    <title>{i18n.t.nav.pricing} - Elygate</title>
</svelte:head>

<div class="h-full max-w-6xl mx-auto space-y-6">
    <div
        class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
    >
        <div>
            <h1
                class="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2"
            >
                <Table class="w-6 h-6 text-indigo-500" />
                {i18n.t.nav.pricing}
            </h1>
            <p class="text-slate-500 dark:text-slate-400 mt-1">
                {activeTab === "list"
                    ? i18n.t.pricing.desc
                    : i18n.t.pricing.configDesc}
            </p>
        </div>
        <div class="flex items-center gap-3">
            <div class="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex">
                <button
                    onclick={() => (activeTab = "list")}
                    class="px-4 py-1.5 text-sm font-medium rounded-lg transition-all {activeTab ===
                    'list'
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}"
                >
                    {i18n.t.pricing.listTab}
                </button>
                {#if isAdmin}
                    <button
                        onclick={() => (activeTab = "config")}
                        class="px-4 py-1.5 text-sm font-medium rounded-lg transition-all {activeTab ===
                        'config'
                            ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}"
                    >
                        {i18n.t.pricing.configTab}
                    </button>
                {/if}
            </div>

            <button
                onclick={loadConfig}
                class="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800 rounded-lg transition-colors"
                title="Refresh"
            >
                <RefreshCw class="w-5 h-5 {isLoading ? 'animate-spin' : ''}" />
            </button>
            {#if isAdmin && activeTab === "config"}
                <button
                    onclick={saveConfig}
                    disabled={isSaving || isLoading}
                    class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
                >
                    {#if isSaving}
                        <div
                            class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                        ></div>
                    {:else}
                        <Save class="w-4 h-4" />
                    {/if}
                    {i18n.t.common.save}
                </button>
            {/if}
        </div>
    </div>

    {#if error}
        <div
            class="p-4 bg-rose-50 border border-rose-100 dark:bg-rose-900/20 dark:border-rose-800/50 rounded-xl flex items-start gap-3"
            transition:slide
        >
            <AlertCircle
                class="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5"
            />
            <div class="text-sm text-rose-600 dark:text-rose-400 flex-1">
                {error}
            </div>
        </div>
    {/if}

    {#if successMessage}
        <div
            class="p-4 bg-emerald-50 border border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800/50 rounded-xl text-sm text-emerald-600 dark:text-emerald-400"
            transition:slide
        >
            {successMessage}
        </div>
    {/if}

    {#if activeTab === "list"}
        {#if isLoading}
            <div
                class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
                in:fade
            >
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr
                                class="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800"
                            >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.t.pricing.tableModel}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.t.pricing.tableType}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.lang === "zh"
                                        ? "输入 (每百万Token)"
                                        : "Input (per 1M)"}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.lang === "zh"
                                        ? "输出 (每百万Token)"
                                        : "Output (per 1M)"}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.t.pricing.tableFixed}</th
                                >
                            </tr>
                        </thead>
                        <tbody
                            class="divide-y divide-slate-100 dark:divide-slate-800"
                        >
                            {#each Array(8) as _, i}
                                <tr
                                    class="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                                >
                                    <td class="px-6 py-4">
                                        <div class="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="h-5 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse"></div>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        {:else}
            <div
                class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
                in:fade
            >
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr
                                class="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800"
                            >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.t.pricing.tableModel}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.t.pricing.tableType}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.lang === "zh"
                                        ? "输入 (每百万Token)"
                                        : "Input (per 1M)"}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.lang === "zh"
                                        ? "输出 (每百万Token)"
                                        : "Output (per 1M)"}</th
                                >
                                <th
                                    class="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                                    >{i18n.t.pricing.tableFixed}</th
                                >
                            </tr>
                        </thead>
                        <tbody
                            class="divide-y divide-slate-100 dark:divide-slate-800"
                        >
                            {#each pricingList as item}
                                <tr
                                    class="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                                >
                                    <td
                                        class="px-6 py-4 font-medium text-slate-900 dark:text-slate-100 truncate max-w-[200px]"
                                        title={item.model}>{item.model}</td
                                    >
                                    <td
                                        class="px-6 py-4 text-sm text-slate-500 dark:text-slate-400"
                                    >
                                        <span
                                            class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                                        >
                                            {item.type}
                                        </span>
                                    </td>
                                    <td
                                        class="px-6 py-4 text-sm text-slate-700 dark:text-slate-300 font-mono"
                                    >
                                        {item.inputPrice !== "-"
                                            ? `$ ${item.inputPrice}`
                                            : "-"}
                                    </td>
                                    <td
                                        class="px-6 py-4 text-sm text-slate-700 dark:text-slate-300 font-mono"
                                    >
                                        {item.outputPrice !== "-"
                                            ? `$ ${item.outputPrice}`
                                            : "-"}
                                    </td>
                                    <td
                                        class="px-6 py-4 text-sm text-emerald-600 dark:text-emerald-400 font-medium"
                                    >
                                        {item.fixedPrice}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>

                <div
                    class="p-6 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800"
                >
                    <h3
                        class="font-medium text-slate-900 dark:text-slate-300 mb-2 flex items-center gap-2"
                    >
                        <AlertCircle class="w-4 h-4 text-indigo-500" />
                        {i18n.t.pricing.costFormula}
                    </h3>
                    <p
                        class="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-2xl"
                    >
                        {i18n.lang === "zh"
                            ? `我们的计费系统使用基于基础汇率 $1.0 = ${session.quotaPerUnit * 2} 单位的倍率系统。Token 计算公式为：(输入 + 输出 × 补全倍率) × 模型倍率。上表显示的是默认分组用户每 100 万 Token 的实际生效美元费率。`
                            : `Our billing system uses a multiplier system tied to a base exchange rate of $1.0 = ${session.quotaPerUnit * 2} units. Tokens are calculated as: (Input + Output × CompletionRatio) × ModelMultiplier. Prices shown above are effective USD rates per 1M tokens for the default user group.`}
                    </p>
                </div>
            </div>
        {/if}
    {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6" in:fade>
            {#each configDefinitions as def}
                <div
                    class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col"
                >
                    <div
                        class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50"
                    >
                        <div class="flex items-center justify-between">
                            <h2
                                class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2"
                            >
                                <Settings2 class="w-4 h-4 text-slate-400" />
                                {def.title}
                            </h2>
                        </div>
                        <p
                            class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed"
                        >
                            {def.desc}
                        </p>
                    </div>
                    <div class="p-1 flex-1 bg-slate-100 dark:bg-slate-950">
                        <textarea
                            class="w-full h-48 md:h-64 p-4 font-mono text-sm bg-transparent outline-none resize-none text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
                            spellcheck="false"
                            bind:value={configs[def.key]}
                        ></textarea>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
