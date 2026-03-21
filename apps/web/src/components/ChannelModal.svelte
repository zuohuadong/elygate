<script lang="ts">
    import { X, Save, AlertTriangle } from "lucide-svelte";
    import { fade, scale } from "svelte/transition";
    import { i18n } from "$lib/i18n/index.svelte";
    import { apiFetch } from "$lib/api";

    import { type Channel } from "$lib/types";

    let {
        show = false,
        channel = null,
        onClose = () => {},
        onSave = (data: Record<string, unknown>) => {},
    } = $props<{
        show: boolean;
        channel: Channel | null;
        onClose: () => void;
        onSave: (data: Record<string, unknown>) => Promise<void>;
    }>();

    // Form state using Svelte 5 $state
    let formData = $state({
        type: 1,
        name: "",
        baseUrl: "",
        key: "",
        models: "",
        modelMapping: "",
        weight: 1,
        status: 1,
        keyConcurrencyLimit: 0,
        keyStrategy: 0,
        priceRatio: 1.0,
    });

    let isSubmitting = $state(false);
    let isFetchingModels = $state(false);
    let fetchModelsError = $state("");
    let error = $state("");
    let showCloseConfirm = $state(false);

    function getInitialFormData(): typeof formData {
        if (channel) {
            return {
                type: channel.type || 1,
                name: channel.name || "",
                baseUrl: channel.baseUrl || "",
                key: channel.key || "",
                models: Array.isArray(channel.models)
                    ? channel.models.join(",")
                    : channel.models || "",
                modelMapping: channel.modelMapping
                    ? JSON.stringify(channel.modelMapping, null, 2)
                    : "{}",
                weight: channel.weight || 1,
                status: channel.status || 1,
                keyConcurrencyLimit: channel.keyConcurrencyLimit || 0,
                keyStrategy: channel.keyStrategy || 0,
                priceRatio: channel.priceRatio || 1.0,
            };
        }
        return {
            type: 1,
            name: "",
            baseUrl: "",
            key: "",
            models: "gpt-3.5-turbo,gpt-4",
            modelMapping: "{}",
            weight: 1,
            status: 1,
            keyConcurrencyLimit: 0,
            keyStrategy: 0,
            priceRatio: 1.0,
        };
    }

    function hasChanges(): boolean {
        const initial = getInitialFormData();
        return JSON.stringify(formData) !== JSON.stringify(initial);
    }

    let isBackdropMouseDown = $state(false);

    function handleMouseDown(e: MouseEvent) {
        isBackdropMouseDown = e.target === e.currentTarget;
    }

    function handleBackdropClick() {
        if (!isBackdropMouseDown) return;
        if (hasChanges()) {
            showCloseConfirm = true;
        } else {
            onClose();
        }
    }

    function confirmClose() {
        showCloseConfirm = false;
        onClose();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            if (hasChanges()) {
                showCloseConfirm = true;
            } else {
                onClose();
            }
        }
    }

    // Fetch models from upstream channel using current input URL and key
    async function fetchModels() {
        // Validate required fields
        if (!formData.baseUrl) {
            fetchModelsError = i18n.lang === "zh" ? "请输入 Base URL" : "Base URL is required";
            return;
        }
        if (!formData.key) {
            fetchModelsError = i18n.lang === "zh" ? "请输入 API Key" : "API Key is required";
            return;
        }

        isFetchingModels = true;
        fetchModelsError = "";

        try {
            const response = await apiFetch<{ success: boolean; models: string[]; message?: string }>(
                `/admin/channels/fetch-models`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        url: formData.baseUrl,
                        key: formData.key,
                        type: formData.type
                    })
                }
            );

            if (response.success && response.models) {
                formData.models = response.models.join(",");
            } else {
                throw new Error(response instanceof Error ? e instanceof Error ? e.message : String(e) : "Failed to fetch models");
            }
        } catch (err: unknown) {
            fetchModelsError = err instanceof Error ? err instanceof Error ? err.message : String(err) : (i18n.lang === "zh" ? "获取模型失败" : "Failed to fetch models");
        } finally {
            isFetchingModels = false;
        }
    }

    // Effect to reset form when channel changes or modal opens
    $effect(() => {
        if (show) {
            formData = getInitialFormData();
            error = "";
            showCloseConfirm = false;
        }
    });

    async function handleSubmit() {
        error = "";
        isSubmitting = true;
        try {
            // Validate modelMapping JSON
            let mapping = {};
            try {
                mapping = JSON.parse(formData.modelMapping || "{}");
            } catch (e: unknown) {
                throw new Error(
                    i18n.lang === "zh"
                        ? "模型映射 JSON 格式错误"
                        : "Invalid model mapping JSON",
                );
            }

            const payload = {
                ...formData,
                models: formData.models
                    .split(",")
                    .map((m) => m.trim())
                    .filter(Boolean),
                modelMapping: mapping,
            };

            await onSave(payload);
        } catch (err: unknown) {
            error = err instanceof Error ? err instanceof Error ? err.message : String(err) : i18n.t.common.failed;
        } finally {
            isSubmitting = false;
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        transition:fade={{ duration: 200 }}
        onmousedown={handleMouseDown}
        onclick={(e) => e.target === e.currentTarget && handleBackdropClick()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        aria-label={channel ? i18n.t.common.edit : i18n.t.common.add}
    >
        <div
            class="bg-white dark:bg-slate-950 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            transition:scale={{ duration: 200, start: 0.95 }}
            onclick={(e) => e.stopPropagation()}
        >
            <!-- Header -->
            <div
                class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"
            >
                <h3
                    class="text-lg font-semibold text-slate-900 dark:text-white"
                >
                    {channel ? i18n.t.common.edit : i18n.t.common.add}
                </h3>
                <button
                    onclick={() => {
                        if (hasChanges()) {
                            showCloseConfirm = true;
                        } else {
                            onClose();
                        }
                    }}
                    class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <X class="w-5 h-5" />
                </button>
            </div>

            <!-- Body -->
            <div
                class="px-6 py-6 max-h-[70vh] overflow-y-auto space-y-4 text-left"
            >
                {#if error}
                    <div
                        class="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-lg border border-rose-100 dark:border-rose-800/50"
                    >
                        {error}
                    </div>
                {/if}

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label
                            for="ch-name"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.channels.name}</label
                        >
                        <input
                            id="ch-name"
                            bind:value={formData.name}
                            placeholder="e.g., OpenAI Official"
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-1.5">
                        <label
                            for="ch-type"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.channels.type}</label
                        >
                        <select
                            id="ch-type"
                            bind:value={formData.type}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value={1}>OpenAI / Compatible</option>
                            <option value={8}>Azure / Microsoft</option>
                            <option value={14}>Anthropic Claude</option>
                            <option value={15}>Baidu Wenxin</option>
                            <option value={17}>Ali Qwen</option>
                            <option value={18}>Xunfei Spark</option>
                            <option value={23}>Google Gemini</option>
                            <option value={24}>Midjourney</option>
                            <option value={31}>DeepSeek</option>
                            <option value={33}>Cloudflare Worker AI</option>
                            <option value={34}>Flux</option>
                            <option value={35}>Udio</option>
                            <option value={41}>Nvidia API</option>
                            <option value={42}>Dakka Draw API (Sora/Veo)</option>
                            <option value={100}>ComfyUI Workspace</option>
                        </select>
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label
                        for="ch-url"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.channels.baseUrl}</label
                    >
                    <input
                        id="ch-url"
                        bind:value={formData.baseUrl}
                        placeholder="https://api.openai.com"
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-1.5">
                    <label
                        for="ch-key"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.channels.key}</label
                    >
                    <textarea
                        id="ch-key"
                        bind:value={formData.key}
                        placeholder={i18n.lang === "zh"
                            ? "sk-...\nsk-...\n(每行一个密钥)"
                            : "sk-...\nsk-...\n(One key per line)"}
                        rows={5}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    ></textarea>
                </div>

                <div class="space-y-1.5">
                    <label
                        for="ch-models"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.channels.models}</label
                    >
                    <div class="flex gap-2">
                        <input
                            id="ch-models"
                            bind:value={formData.models}
                            placeholder="gpt-3.5-turbo,gpt-4"
                            class="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <button
                            type="button"
                            onclick={fetchModels}
                            disabled={isFetchingModels || !channel?.id}
                            class="px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors whitespace-nowrap"
                        >
                            {#if isFetchingModels}
                                <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            {:else}
                                {i18n.lang === "zh" ? "获取模型" : "Fetch Models"}
                            {/if}
                        </button>
                    </div>
                    {#if fetchModelsError}
                        <p class="text-xs text-rose-600 dark:text-rose-400 mt-1">{fetchModelsError}</p>
                    {/if}
                </div>

                <div class="space-y-1.5">
                    <label
                        for="ch-mapping"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.channels.modelMapping}</label
                    >
                    <textarea
                        id="ch-mapping"
                        bind:value={formData.modelMapping}
                        rows="3"
                        placeholder="&#123;&quot;gpt-4&quot;: &quot;gpt-4-32k&quot;&#125;"
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    ></textarea>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label
                            for="ch-weight"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.channels.weight}</label
                        >
                        <input
                            id="ch-weight"
                            type="number"
                            bind:value={formData.weight}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-1.5">
                        <label
                            for="ch-status"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.channels.status}</label
                        >
                        <select
                            id="ch-status"
                            bind:value={formData.status}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value={1}>{i18n.t.channels.active}</option>
                            <option value={2}>{i18n.t.channels.disabled}</option
                            >
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label
                            for="ch-strategy"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "多密钥策略"
                                : "Key Strategy"}</label
                        >
                        <select
                            id="ch-strategy"
                            bind:value={formData.keyStrategy}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value={0}
                                >{i18n.lang === "zh"
                                    ? "负载均衡 (随机)"
                                    : "Load Balance (Random)"}</option
                            >
                            <option value={1}
                                >{i18n.lang === "zh"
                                    ? "依次消耗"
                                    : "Sequential"}</option
                            >
                        </select>
                    </div>
                    <div class="space-y-1.5">
                        <label
                            for="ch-price-ratio"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "价格倍率 (USD=1.0)"
                                : "Price Ratio (USD=1.0)"}</label
                        >
                        <input
                            id="ch-price-ratio"
                            type="number"
                            step="0.0001"
                            bind:value={formData.priceRatio}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-1.5">
                        <label
                            for="ch-concurrency"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "单 Key 并发限制 (0=不限)"
                                : "Key Concurrency (0=Unlimited)"}</label
                        >
                        <input
                            id="ch-concurrency"
                            type="number"
                            min="0"
                            bind:value={formData.keyConcurrencyLimit}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div
                class="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50"
            >
                <button
                    onclick={() => {
                        if (hasChanges()) {
                            showCloseConfirm = true;
                        } else {
                            onClose();
                        }
                    }}
                    class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                    {i18n.t.common.cancel}
                </button>
                <button
                    onclick={handleSubmit}
                    disabled={isSubmitting}
                    class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
                >
                    {#if isSubmitting}
                        <div
                            class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                        ></div>
                    {:else}
                        <Save class="w-4 h-4" />
                    {/if}
                    {i18n.t.common.save}
                </button>
            </div>
        </div>
    </div>

    <!-- Close Confirmation Dialog -->
    {#if showCloseConfirm}
        <div
            class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
            transition:fade={{ duration: 150 }}
        >
            <div
                class="bg-white dark:bg-slate-950 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6"
                transition:scale={{ duration: 150, start: 0.95 }}
            >
                <div class="flex items-center gap-3 mb-4">
                    <div class="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                        <AlertTriangle class="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h4 class="text-lg font-semibold text-slate-900 dark:text-white">
                        {i18n.lang === "zh" ? "放弃更改？" : "Discard changes?"}
                    </h4>
                </div>
                <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">
                    {i18n.lang === "zh" 
                        ? "您有未保存的更改，确定要关闭吗？" 
                        : "You have unsaved changes. Are you sure you want to close?"}
                </p>
                <div class="flex gap-3">
                    <button
                        onclick={() => showCloseConfirm = false}
                        class="flex-1 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        {i18n.lang === "zh" ? "继续编辑" : "Keep Editing"}
                    </button>
                    <button
                        onclick={confirmClose}
                        class="flex-1 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
                    >
                        {i18n.lang === "zh" ? "放弃更改" : "Discard"}
                    </button>
                </div>
            </div>
        </div>
    {/if}
{/if}
