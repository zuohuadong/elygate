<script lang="ts">
    import { onMount } from "svelte";
    import { apiFetch } from "$lib/api";
    import {
        Search,
        RefreshCw,
        MonitorSpeaker,
        XCircle,
        Layers,
        Brain,
        Image as ImageIcon,
        Sparkles,
        Mic,
        Video,
        Zap,
        Compass,
        Filter,
        Lightbulb,
        Clock,
        AlertCircle,
    } from "lucide-svelte";
    import { fade, slide, scale } from "svelte/transition";
    import { i18n } from "$lib/i18n/index.svelte";

    let models = $state<any[]>([]);
    let isLoading = $state(true);
    let error = $state("");
    let searchQuery = $state("");
    let isAdmin = $state(false);

    // Filter states
    let activeProvider = $state("all");
    let activeCapability = $state("all");
    let activeStatus = $state("all");

    const providers = [
        { id: "all", label: "全部", labelEn: "All" },
        { id: "openai", label: "OpenAI", labelEn: "OpenAI" },
        { id: "anthropic", label: "Anthropic", labelEn: "Anthropic" },
        { id: "google", label: "Google", labelEn: "Google" },
        { id: "deepseek", label: "DeepSeek", labelEn: "DeepSeek" },
        { id: "meta", label: "Meta (Llama)", labelEn: "Meta (Llama)" },
        { id: "nvidia", label: "NVIDIA", labelEn: "NVIDIA" },
        { id: "mistral", label: "Mistral", labelEn: "Mistral" },
        { id: "cohere", label: "Cohere", labelEn: "Cohere" },
        { id: "alibaba", label: "阿里通义", labelEn: "Alibaba" },
        { id: "zhipu", label: "智谱清言", labelEn: "Zhipu" },
        { id: "minimax", label: "MiniMax", labelEn: "MiniMax" },
        { id: "bytedance", label: "字节跳动", labelEn: "ByteDance" },
        { id: "baichuan", label: "百川智能", labelEn: "Baichuan" },
        { id: "01ai", label: "零一万物", labelEn: "01.AI" },
        { id: "moonshot", label: "月之暗面", labelEn: "Moonshot" },
        { id: "others", label: "其他", labelEn: "Others" },
    ];

    const capabilities = [
        { id: "all", label: "全部", labelEn: "All", icon: Compass },
        { id: "thinking", label: "推理", labelEn: "Thinking", icon: Lightbulb },
        { id: "chat", label: "对话", labelEn: "Chat", icon: Brain },
        { id: "vision", label: "视觉", labelEn: "Vision", icon: Zap },
        { id: "image", label: "绘图", labelEn: "Image", icon: ImageIcon },
        { id: "video", label: "视频", labelEn: "Video", icon: Video },
        { id: "audio", label: "语音", labelEn: "Audio", icon: Mic },
        { id: "embedding", label: "向量", labelEn: "Embedding", icon: Layers },
    ];

    function getProvider(modelId: string): string {
        const id = modelId.toLowerCase();

        // Smart Probe: Infer real provider based on dictionary
        const matchers = {
            openai: ["openai", "gpt-", "o1-", "o3-", "dall-e"],
            anthropic: ["anthropic", "claude-"],
            google: ["google", "gemini-", "palm"],
            meta: ["meta", "llama"],
            deepseek: ["deepseek"],
            nvidia: ["nvidia"],
            mistral: ["mistral"],
            cohere: ["cohere", "command-"],
            alibaba: ["qwen", "alibaba", "tongyi"],
            zhipu: ["glm", "zhipu", "chatglm"],
            minimax: ["minimax", "abab"],
            bytedance: ["doubao", "bytedance", "skylark"],
            baichuan: ["baichuan"],
            "01ai": ["yi-", "01-ai", "01ai"],
            moonshot: ["moonshot", "kimi"],
            stepfun: ["stepfun", "step-"],
            tencent: ["hunyuan", "tencent"]
        };

        for (const [provider, substrings] of Object.entries(matchers)) {
            for (const sub of substrings) {
                if (id.includes(sub)) {
                    return provider;
                }
            }
        }
        return "others";
    }

    function parseModelId(modelId: string): {
        provider: string;
        modelName: string;
        providerId: string;
    } {
        const providerId = getProvider(modelId);
        const providerObj = providers.find(p => p.id === providerId) || providers[0]; // fallback
        const providerLabel = i18n.lang === "zh" ? providerObj.label : providerObj.labelEn;

        let cleanName = modelId;

        // Special handling for market prefixes like "Pro/"
        if (cleanName.toLowerCase().startsWith("pro/")) {
            cleanName = cleanName.substring(4);
        }

        if (cleanName.includes("/")) {
            const parts = cleanName.split("/");
            cleanName = parts.slice(1).join("/");
        } else if (cleanName.includes(":")) {
            const parts = cleanName.split(":");
            cleanName = parts.slice(1).join(":");
        }

        return { 
            provider: providerId === 'others' && cleanName !== modelId ? modelId.split('/')[0] : providerLabel, 
            modelName: cleanName,
            providerId: providerId 
        };
    }

    function getCapability(modelId: string): string {
        const id = modelId.toLowerCase();

        // Check for reasoning/thinking models first
        if (
            id.includes("thinking") ||
            id.includes("reasoning") ||
            id.includes("-r1") ||
            id.startsWith("o1-") ||
            id.startsWith("o3-")
        ) {
            return "thinking";
        }

        if (id.includes("text-embedding") || id.includes("-embedding-"))
            return "embedding";
        if (
            id.includes("dall-e") ||
            id.includes("midjourney") ||
            id.includes("stable-diffusion") ||
            id.includes("flux")
        )
            return "image";
        if (
            id.includes("tts-") ||
            id.includes("whisper-") ||
            id.includes("audio-")
        )
            return "audio";
        if (
            id.includes("video-") ||
            id.includes("sora") ||
            id.includes("luma") ||
            id.includes("kling")
        )
            return "video";
        if (
            id.includes("vision") ||
            id.includes("-vl") ||
            id === "gpt-4o" ||
            id === "gpt-4-turbo" ||
            id.startsWith("claude-3-5")
        )
            return "vision";
        return "chat";
    }

    async function loadModels() {
        isLoading = true;
        error = "";
        try {
            const res = await apiFetch<any>("/v1/models");
            if (Array.isArray(res)) {
                models = res;
            } else if (res && Array.isArray((res as any).data)) {
                models = (res as any).data;
            } else {
                models = [];
            }
        } catch (err: any) {
            console.warn("Failed to load models:", err);
            error =
                i18n.lang === "zh"
                    ? "无法加载模型列表"
                    : "Failed to load models";
            models = [];
        } finally {
            isLoading = false;
        }
    }

    let displayLimit = $state(24);

    // Reset displayLimit on filter or query change
    function resetFilters() {
        searchQuery = "";
        activeProvider = "all";
        activeCapability = "all";
        activeStatus = "all";
        displayLimit = 24;
    }

    let preStatusFilteredModels = $derived(
        models.filter((m) => {
            const id = (m.id || "").toLowerCase();
            const name = (m.name || "").toLowerCase();
            const q = searchQuery.toLowerCase();
            const matchesSearch = id.includes(q) || name.includes(q);
            const matchesProvider =
                activeProvider === "all" || getProvider(id) === activeProvider;
            const matchesCapability =
                activeCapability === "all" ||
                getCapability(id) === activeCapability;
            return matchesSearch && matchesProvider && matchesCapability;
        }),
    );

    let counts = $derived({
        all: preStatusFilteredModels.length,
        online: preStatusFilteredModels.filter(
            (m) => (m.status || "online") === "online",
        ).length,
        busy: preStatusFilteredModels.filter((m) => m.status === "busy").length,
        offline: preStatusFilteredModels.filter((m) => m.status === "offline")
            .length,
    });

    let filteredModels = $derived(
        preStatusFilteredModels.filter(
            (m) =>
                activeStatus === "all" ||
                (m.status || "online") === activeStatus,
        ),
    );

    let displayedModels = $derived(filteredModels.slice(0, displayLimit));

    // Watch for filter changes and reset displayLimit
    $effect(() => {
        const _ =
            searchQuery + activeProvider + activeCapability + activeStatus;
        displayLimit = 24;
    });

    onMount(() => {
        const role = localStorage.getItem("admin_role");
        isAdmin = role ? parseInt(role, 10) >= 10 : false;
        loadModels();
    });

    // Svelte Action for lazy loading
    function lazyLoad(node: HTMLElement) {
        const observer = new IntersectionObserver(
            (entries) => {
                if (
                    entries[0].isIntersecting &&
                    displayLimit < filteredModels.length
                ) {
                    displayLimit += 24;
                }
            },
            { threshold: 0.1 },
        );
        observer.observe(node);
        return {
            destroy() {
                observer.disconnect();
            },
        };
    }
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
    <div class="space-y-4">
        <div
            class="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl flex flex-col lg:flex-row gap-4 justify-between items-center shadow-sm"
        >
            <div class="relative w-full lg:max-w-md">
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

            <div
                class="flex flex-wrap items-center gap-2 justify-center lg:justify-end"
            >
                <div
                    class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg text-xs font-medium text-slate-500"
                >
                    <Filter class="w-3.5 h-3.5" />
                    {i18n.lang === "zh" ? "筛选" : "Filters"}
                </div>
                <div
                    class="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block"
                ></div>

                {#if activeProvider !== "all" || activeCapability !== "all" || searchQuery !== ""}
                    <button
                        onclick={resetFilters}
                        class="px-3 py-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors flex items-center gap-1.5"
                        transition:fade
                    >
                        <RefreshCw class="w-3.5 h-3.5" />
                        {i18n.lang === "zh" ? "重置" : "Reset"}
                    </button>
                {/if}

                <div
                    class="text-sm text-slate-500 font-medium whitespace-nowrap"
                >
                    {i18n.lang === "zh" ? "找到" : "Found"}:
                    <span class="text-indigo-600 dark:text-indigo-400 font-bold"
                        >{filteredModels.length}</span
                    >
                </div>
            </div>
        </div>

        <!-- Multi-dimensional Filters -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Provider Filter -->
            <div
                class="bg-white/40 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 p-3 rounded-2xl"
            >
                <div class="flex items-center gap-2 mb-3 px-1">
                    <Zap class="w-4 h-4 text-amber-500" />
                    <span
                        class="text-xs font-bold uppercase tracking-wider text-slate-400"
                    >
                        {i18n.lang === "zh" ? "模型厂商" : "Providers"}
                    </span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    {#each providers as p}
                        <button
                            onclick={() => (activeProvider = p.id)}
                            class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all {activeProvider ===
                            p.id
                                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20 scale-105'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700'}"
                        >
                            {i18n.lang === "zh" ? p.label : p.labelEn}
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Capability Filter -->
            <div
                class="bg-white/40 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 p-3 rounded-2xl"
            >
                <div class="flex items-center gap-2 mb-3 px-1">
                    <Sparkles class="w-4 h-4 text-indigo-500" />
                    <span
                        class="text-xs font-bold uppercase tracking-wider text-slate-400"
                    >
                        {i18n.lang === "zh" ? "核心功能" : "Capabilities"}
                    </span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    {#each capabilities as c}
                        <button
                            onclick={() => (activeCapability = c.id)}
                            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all {activeCapability ===
                            c.id
                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20 scale-105'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-700'}"
                        >
                            <c.icon class="w-3.5 h-3.5" />
                            {i18n.lang === "zh" ? c.label : c.labelEn}
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Availability Filter -->
            <div
                class="bg-white/40 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 p-3 rounded-2xl md:col-span-2"
            >
                <div class="flex items-center gap-2 mb-3 px-1">
                    <MonitorSpeaker class="w-4 h-4 text-emerald-500" />
                    <span
                        class="text-xs font-bold uppercase tracking-wider text-slate-400"
                    >
                        {i18n.lang === "zh" ? "可用性" : "Availability"}
                    </span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    <button
                        onclick={() => (activeStatus = "all")}
                        class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all {activeStatus ===
                        'all'
                            ? 'bg-slate-800 text-white shadow-md scale-105'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-slate-300'}"
                    >
                        {i18n.lang === "zh" ? "全部" : "All"}
                        <span class="ml-1 opacity-60 text-[10px]"
                            >({counts.all})</span
                        >
                    </button>
                    <button
                        onclick={() => (activeStatus = "online")}
                        class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all {activeStatus ===
                        'online'
                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20 scale-105'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-emerald-300'}"
                    >
                        <span
                            class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
                        ></span>
                        {i18n.lang === "zh" ? "仅在线" : "Online Only"}
                        <span class="ml-1 opacity-80 text-[10px]"
                            >({counts.online})</span
                        >
                    </button>
                    <button
                        onclick={() => (activeStatus = "busy")}
                        class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all {activeStatus ===
                        'busy'
                            ? 'bg-amber-600 text-white shadow-md shadow-amber-500/20 scale-105'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-amber-300'}"
                    >
                        <span
                            class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
                        ></span>
                        {i18n.lang === "zh" ? "繁忙" : "Busy"}
                        <span class="ml-1 opacity-80 text-[10px]"
                            >({counts.busy})</span
                        >
                    </button>
                    <button
                        onclick={() => (activeStatus = "offline")}
                        class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all {activeStatus ===
                        'offline'
                            ? 'bg-rose-600 text-white shadow-md shadow-rose-500/20 scale-105'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-rose-300'}"
                    >
                        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"
                        ></span>
                        {i18n.lang === "zh" ? "已离线" : "Offline"}
                        <span class="ml-1 opacity-80 text-[10px]"
                            >({counts.offline})</span
                        >
                    </button>
                </div>
            </div>
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
            {#each displayedModels as model (model.id)}
                {@const isThinking = getCapability(model.id) === "thinking"}
                {@const parsed = parseModelId(model.id)}
                <div
                    class="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/80 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:shadow-md hover:-translate-y-1 flex flex-col group relative overflow-hidden {model.status ===
                    'offline'
                        ? 'opacity-60 grayscale-[0.5]'
                        : ''} {isThinking
                        ? 'ring-1 ring-indigo-500/20 dark:ring-indigo-400/20 ring-inset'
                        : ''}"
                    transition:fade={{ duration: 150 }}
                >
                    {#if isThinking}
                        <div
                            class="absolute -right-8 -top-8 w-24 h-24 bg-indigo-500/5 dark:bg-indigo-400/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-colors"
                        ></div>
                    {/if}

                    <!-- Status Indicator Line -->
                    <div
                        class="absolute top-0 left-0 w-full h-1 {model.status ===
                        'offline'
                            ? 'bg-slate-300 dark:bg-slate-700'
                            : model.status === 'busy'
                              ? 'bg-amber-400'
                              : 'bg-gradient-to-r from-emerald-400 to-teal-500'}"
                    ></div>

                    <!-- Header -->
                    <div class="mb-4">
                        <div class="space-y-1 mb-3">
                            <!-- Provider Name -->
                            <p
                                class="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400"
                            >
                                {parsed.provider}
                            </p>
                            <!-- Model Name -->
                            <h3
                                class="font-bold text-slate-900 dark:text-white text-lg leading-tight"
                                title={model.name || parsed.modelName}
                            >
                                {model.name || parsed.modelName}
                            </h3>
                            {#if model.name && model.name !== model.id}
                                <p
                                    class="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate flex items-center gap-2"
                                    title={model.id}
                                >
                                    <span>ID: {model.id}</span>
                                    {#if model.latency && model.status !== "offline"}
                                        <span
                                            class="flex items-center gap-0.5 text-slate-400 dark:text-slate-600"
                                        >
                                            <Clock class="w-2.5 h-2.5" />
                                            {model.latency}ms
                                        </span>
                                    {/if}
                                </p>
                            {/if}
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            {#if model.status === "offline"}
                                <span
                                    class="inline-flex items-center gap-1.2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                                >
                                    <span
                                        class="w-1 h-1 rounded-full bg-slate-400 mr-1"
                                    ></span>
                                    {i18n.lang === "zh" ? "离线" : "Offline"}
                                </span>
                            {:else if model.status === "busy"}
                                <span
                                    class="inline-flex items-center gap-1.2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
                                    title={i18n.lang === "zh"
                                        ? "模型响应延迟较高"
                                        : "High response latency"}
                                >
                                    <AlertCircle class="w-2.5 h-2.5 mr-1" />
                                    {i18n.lang === "zh" ? "繁忙" : "Busy"}
                                </span>
                            {:else}
                                <span
                                    class="inline-flex items-center gap-1.2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                                >
                                    <span
                                        class="w-1 h-1 rounded-full bg-emerald-500 mr-1"
                                    ></span>
                                    {i18n.lang === "zh" ? "在线" : "Online"}
                                </span>
                            {/if}
                            <span
                                class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium {isThinking
                                    ? 'bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20 ring-1 ring-indigo-500/10'
                                    : 'bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'} uppercase tracking-wide"
                            >
                                {capabilities.find(
                                    (c) => c.id === getCapability(model.id),
                                )?.label || "Chat"}
                            </span>
                        </div>
                    </div>

                    <!-- Details -->
                    <div class="flex-1 mt-1 mb-6">
                        <p
                            class="text-sm text-slate-500 dark:text-slate-400 line-clamp-3 leading-relaxed italic"
                        >
                            {model.description ||
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

            <!-- Scroll Loader Trigger -->
            {#if displayLimit < filteredModels.length}
                <div
                    use:lazyLoad
                    class="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4 py-12 flex justify-center"
                >
                    <div class="flex items-center gap-3 text-slate-400">
                        <RefreshCw class="w-5 h-5 animate-spin" />
                        <span class="text-sm font-medium">
                            {i18n.lang === "zh"
                                ? "加载更多模型..."
                                : "Loading more models..."}
                        </span>
                    </div>
                </div>
            {:else if filteredModels.length > 24}
                <div
                    class="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4 py-8 text-center text-slate-400 text-sm font-medium"
                >
                    {i18n.lang === "zh"
                        ? "已显示全部 {filteredModels.length} 个模型"
                        : "All {filteredModels.length} models displayed"}
                </div>
            {/if}
        {/if}
    </div>
</div>
