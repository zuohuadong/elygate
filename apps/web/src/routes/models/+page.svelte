<script lang="ts">
    import { onMount } from "svelte";
    import { apiFetch } from "$lib/api";
    import { Search, RefreshCw, MonitorSpeaker, XCircle } from "lucide-svelte";
    import { fade, slide } from "svelte/transition";
    import { i18n } from "$lib/i18n/index.svelte";

    let models = $state<any[]>([]);
    let isLoading = $state(true);
    let error = $state("");
    let searchQuery = $state("");

    async function loadModels() {
        isLoading = true;
        error = "";
        try {
            // New API usually has an endpoint for models, but if it doesn't exist yet,
            // we will catch the 404 and show a placeholder or empty list.
            const res = await apiFetch("/admin/models");
            if (Array.isArray(res)) {
                models = res;
            } else if (res && Array.isArray(res.data)) {
                models = res.data;
            } else {
                models = [];
            }
        } catch (err: any) {
            // For now, if the backend route is missing, we just show a friendly message or empty list
            // rather than a hard error block, to keep the UI looking complete.
            console.warn("Failed to load models:", err);
            error =
                i18n.lang === "zh"
                    ? "无法加载模型列表，后端接口可能未实现。"
                    : "Failed to load models. Backend endpoint may not be implemented yet.";
            models = [];
        } finally {
            isLoading = false;
        }
    }

    onMount(() => {
        loadModels();
    });

    let filteredModels = $derived(
        models.filter(
            (m) =>
                (m.id || "")
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                (m.name || "")
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
        ),
    );
</script>

<svelte:head>
    <title>Elygate – {i18n.lang === "zh" ? "模型管理" : "Models"}</title>
</svelte:head>

<div class="max-w-7xl mx-auto space-y-6">
    <!-- Header Section -->
    <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
    >
        <div>
            <h1
                class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"
            >
                <MonitorSpeaker class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "模型管理" : "Models"}
            </h1>
            <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {i18n.lang === "zh"
                    ? "查看系统支持的可用 AI 模型。"
                    : "View available AI models supported by the system."}
            </p>
        </div>

        <div class="flex items-center gap-3">
            <button
                onclick={loadModels}
                disabled={isLoading}
                class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all font-medium text-sm shadow-sm disabled:opacity-50"
            >
                <RefreshCw class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" />
                {i18n.t.common.refresh}
            </button>
        </div>
    </div>

    {#if error}
        <div
            class="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-xl text-sm flex items-center gap-3"
            transition:slide
        >
            <XCircle class="w-5 h-5 flex-shrink-0" />
            {error}
        </div>
    {/if}

    <!-- Toolbar -->
    <div
        class="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl flex flex-col sm:flex-row gap-4 justify-between items-center shadow-sm"
    >
        <div class="relative w-full sm:max-w-md">
            <Search
                class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            />
            <input
                type="text"
                bind:value={searchQuery}
                placeholder={i18n.t.common.search}
                class="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-slate-900 dark:text-white placeholder-slate-400"
            />
        </div>
        <div class="text-sm text-slate-500 font-medium">
            {i18n.lang === "zh" ? "总计" : "Total"}: {filteredModels.length}
        </div>
    </div>

    <!-- Data Table -->
    <div
        class="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/60 dark:border-slate-800/60 rounded-2xl shadow-sm overflow-hidden"
    >
        <div class="overflow-x-auto">
            <table class="w-full text-left text-sm whitespace-nowrap">
                <thead
                    class="bg-slate-50/50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400 border-b border-slate-200/60 dark:border-slate-800/60"
                >
                    <tr>
                        <th class="px-6 py-4 font-semibold text-xs uppercase"
                            >ID</th
                        >
                        <th class="px-6 py-4 font-semibold text-xs uppercase"
                            >Name / Description</th
                        >
                        <th class="px-6 py-4 font-semibold text-xs uppercase"
                            >Type</th
                        >
                    </tr>
                </thead>
                <tbody
                    class="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300"
                >
                    {#if isLoading}
                        <tr>
                            <td colspan="3" class="px-6 py-8 text-center">
                                <div
                                    class="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"
                                ></div>
                            </td>
                        </tr>
                    {:else if filteredModels.length === 0}
                        <tr>
                            <td
                                colspan="3"
                                class="px-6 py-12 text-center text-slate-400 dark:text-slate-500"
                            >
                                <div
                                    class="flex flex-col items-center justify-center gap-3"
                                >
                                    <MonitorSpeaker
                                        class="w-10 h-10 opacity-50"
                                    />
                                    <p class="text-base font-medium">
                                        {i18n.lang === "zh"
                                            ? "暂无可用模型"
                                            : "No models available"}
                                    </p>
                                    <p class="text-sm opacity-75">
                                        {i18n.lang === "zh"
                                            ? "系统尚未配置或支持任何模型。"
                                            : "No models have been configured or supported yet."}
                                    </p>
                                </div>
                            </td>
                        </tr>
                    {:else}
                        {#each filteredModels as model (model.id)}
                            <tr
                                class="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors group"
                                transition:fade={{ duration: 150 }}
                            >
                                <td
                                    class="px-6 py-4 text-slate-900 dark:text-white font-medium"
                                >
                                    {model.id || "unknown"}
                                </td>
                                <td
                                    class="px-6 py-4 text-slate-500 dark:text-slate-400"
                                >
                                    {model.name || model.description || "—"}
                                </td>
                                <td class="px-6 py-4">
                                    <span
                                        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20"
                                    >
                                        {model.object || "model"}
                                    </span>
                                </td>
                            </tr>
                        {/each}
                    {/if}
                </tbody>
            </table>
        </div>
    </div>
</div>
