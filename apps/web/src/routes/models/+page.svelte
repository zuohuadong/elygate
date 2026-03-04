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
    let isAdmin = $state(false);

    async function loadModels() {
        isLoading = true;
        error = "";
        try {
            // Fetch from the public /v1/models endpoint instead of /admin/models
            const res = await apiFetch<any>("/v1/models");
            if (Array.isArray(res)) {
                models = res;
            } else if (res && Array.isArray((res as any).data)) {
                models = (res as any).data;
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
        const role = localStorage.getItem("admin_role");
        isAdmin = role ? parseInt(role, 10) >= 10 : false;
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
                {isAdmin
                    ? i18n.lang === "zh"
                        ? "模型管理"
                        : "Model Management"
                    : i18n.lang === "zh"
                      ? "可用模型"
                      : "Available Models"}
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
                {i18n.lang === "zh" ? "刷新" : "Refresh"}
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

    <!-- Model Cards Grid -->
    <div
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
    >
        {#if isLoading}
            {#each Array(8) as _}
                <div
                    class="bg-white/60 dark:bg-slate-900/60 rounded-2xl p-6 border border-slate-200/60 dark:border-slate-800/60 shadow-sm animate-pulse flex flex-col gap-4"
                >
                    <div
                        class="h-6 bg-slate-200 dark:bg-slate-800 rounded w-2/3"
                    ></div>
                    <div
                        class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4"
                    ></div>
                    <div
                        class="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between"
                    >
                        <div
                            class="h-8 bg-slate-200 dark:bg-slate-800 rounded w-16"
                        ></div>
                        <div
                            class="h-8 bg-slate-200 dark:bg-slate-800 rounded w-16"
                        ></div>
                    </div>
                </div>
            {/each}
        {:else if filteredModels.length === 0}
            <div
                class="col-span-full py-16 text-center bg-white/60 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl shadow-sm"
            >
                <div class="flex flex-col items-center justify-center gap-3">
                    <MonitorSpeaker
                        class="w-12 h-12 text-slate-300 dark:text-slate-600 mb-2"
                    />
                    <p
                        class="text-lg font-semibold text-slate-700 dark:text-slate-300"
                    >
                        {i18n.lang === "zh"
                            ? "暂无可用模型"
                            : "No models available"}
                    </p>
                    <p class="text-sm text-slate-500 max-w-sm">
                        {i18n.lang === "zh"
                            ? "系统尚未配置或支持任何模型，或者当前搜索条件未匹配任何结果。"
                            : "No models have been configured yet, or the current search terms yielded no results."}
                    </p>
                </div>
            </div>
        {:else}
            {#each filteredModels as model (model.id)}
                <div
                    class="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/80 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:shadow-md hover:-translate-y-1 flex flex-col group relative overflow-hidden"
                    transition:fade={{ duration: 150 }}
                >
                    <!-- Status Indicator Line -->
                    <div
                        class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-teal-500"
                    ></div>

                    <!-- Header -->
                    <div class="mb-4">
                        <div class="flex items-center justify-between mb-2">
                            <h3
                                class="font-bold text-slate-900 dark:text-white truncate"
                                title={model.id}
                            >
                                {model.id}
                            </h3>
                        </div>
                        <div class="flex items-center gap-2">
                            <span
                                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                            >
                                <span
                                    class="w-1.5 h-1.5 rounded-full bg-emerald-500"
                                ></span>
                                {i18n.lang === "zh" ? "可用" : "Available"}
                            </span>
                            <span
                                class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20 uppercase tracking-wide"
                            >
                                {model.object || "chat"}
                            </span>
                        </div>
                    </div>

                    <!-- Details -->
                    <div class="flex-1 mt-2 mb-6">
                        <p
                            class="text-sm text-slate-500 dark:text-slate-400 line-clamp-3 leading-relaxed"
                        >
                            {model.name ||
                                model.description ||
                                (i18n.lang === "zh"
                                    ? "标准对话模型支持"
                                    : "Standard conversational model support.")}
                        </p>
                    </div>

                    <!-- Footer Actions -->
                    <div
                        class="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between"
                    >
                        <a
                            href="/pricing"
                            class="text-xs font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
                        >
                            {i18n.lang === "zh"
                                ? "查看计费规则"
                                : "View Pricing"} &rarr;
                        </a>
                        <div class="flex gap-2 text-slate-400">
                            <button
                                title="API Docs"
                                class="p-1 hover:text-slate-900 dark:hover:text-white transition-colors"
                                onclick={() =>
                                    (window.location.href = "/consumer/docs")}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    ><path
                                        d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"
                                    /><path
                                        d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"
                                    /></svg
                                >
                            </button>
                        </div>
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>
