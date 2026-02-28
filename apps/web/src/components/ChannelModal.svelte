<script lang="ts">
    import { X, Save } from "lucide-svelte";
    import { fade, scale } from "svelte/transition";
    import { i18n } from "$lib/i18n";

    let { 
        show = false, 
        channel = null, 
        onClose = () => {}, 
        onSave = (data: any) => {} 
    } = $props<{
        show: boolean;
        channel: any | null;
        onClose: () => void;
        onSave: (data: any) => Promise<void>;
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
        status: 1
    });

    let isSubmitting = $state(false);
    let error = $state("");

    // Effect to reset form when channel changes or modal opens
    $effect(() => {
        if (show) {
            if (channel) {
                formData = {
                    type: channel.type || 1,
                    name: channel.name || "",
                    baseUrl: channel.baseUrl || "",
                    key: channel.key || "",
                    models: Array.isArray(channel.models) ? channel.models.join(",") : (channel.models || ""),
                    modelMapping: channel.modelMapping ? JSON.stringify(channel.modelMapping, null, 2) : "{}",
                    weight: channel.weight || 1,
                    status: channel.status || 1
                };
            } else {
                formData = {
                    type: 1,
                    name: "",
                    baseUrl: "",
                    key: "",
                    models: "gpt-3.5-turbo,gpt-4",
                    modelMapping: "{}",
                    weight: 1,
                    status: 1
                };
            }
            error = "";
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
            } catch (e: any) {
                throw new Error(i18n.lang === 'zh' ? "模型映射 JSON 格式错误" : "Invalid model mapping JSON");
            }

            const payload = {
                ...formData,
                models: formData.models.split(",").map(m => m.trim()).filter(Boolean),
                modelMapping: mapping
            };

            await onSave(payload);
        } catch (err: any) {
            error = err.message || i18n.t.common.failed;
        } finally {
            isSubmitting = false;
        }
    }
</script>

{#if show}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        transition:fade={{ duration: 200 }}
        onclick={onClose}
    >
        <div 
            class="bg-white dark:bg-slate-950 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            transition:scale={{ duration: 200, start: 0.95 }}
            onclick={e => e.stopPropagation()}
        >
            <!-- Header -->
            <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                    {channel ? i18n.t.common.edit : i18n.t.common.add}
                </h3>
                <button 
                    onclick={onClose}
                    class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <X class="w-5 h-5" />
                </button>
            </div>

            <!-- Body -->
            <div class="px-6 py-6 max-h-[70vh] overflow-y-auto space-y-4 text-left">
                {#if error}
                    <div class="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-lg border border-rose-100 dark:border-rose-800/50">
                        {error}
                    </div>
                {/if}

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label for="ch-name" class="text-sm font-medium text-slate-700 dark:text-slate-300">{i18n.t.channels.name}</label>
                        <input 
                            id="ch-name"
                            bind:value={formData.name}
                            placeholder="e.g. Official OpenAI"
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-1.5">
                        <label for="ch-type" class="text-sm font-medium text-slate-700 dark:text-slate-300">{i18n.t.channels.type}</label>
                        <select 
                            id="ch-type"
                            bind:value={formData.type}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value={1}>OpenAI</option>
                            <option value={8}>Azure OpenAI</option>
                            <option value={14}>Anthropic</option>
                            <option value={23}>Google Gemini</option>
                        </select>
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label for="ch-url" class="text-sm font-medium text-slate-700 dark:text-slate-300">{i18n.t.channels.baseUrl}</label>
                    <input 
                        id="ch-url"
                        bind:value={formData.baseUrl}
                        placeholder="https://api.openai.com"
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-1.5">
                    <label for="ch-key" class="text-sm font-medium text-slate-700 dark:text-slate-300">{i18n.t.channels.key}</label>
                    <textarea 
                        id="ch-key"
                        bind:value={formData.key}
                        rows="2"
                        placeholder="sk-..."
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    ></textarea>
                </div>

                <div class="space-y-1.5">
                    <label for="ch-models" class="text-sm font-medium text-slate-700 dark:text-slate-300">{i18n.t.channels.models}</label>
                    <input 
                        id="ch-models"
                        bind:value={formData.models}
                        placeholder="gpt-3.5-turbo,gpt-4"
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                    <textarea 
                        id="ch-mapping"
                        bind:value={formData.modelMapping}
                        rows="3"
                        placeholder='{"gpt-4": "gpt-4-32k"}'
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    ></textarea>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label for="ch-weight" class="text-sm font-medium text-slate-700 dark:text-slate-300">{i18n.t.channels.weight}</label>
                        <input 
                            id="ch-weight"
                            type="number"
                            bind:value={formData.weight}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-1.5">
                        <label for="ch-status" class="text-sm font-medium text-slate-700 dark:text-slate-300">{i18n.t.channels.status}</label>
                        <select 
                            id="ch-status"
                            bind:value={formData.status}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value={1}>{i18n.t.channels.active}</option>
                            <option value={2}>{i18n.t.channels.disabled}</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50">
                <button 
                    onclick={onClose}
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
                        <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    {:else}
                        <Save class="w-4 h-4" />
                    {/if}
                    {i18n.t.common.save}
                </button>
            </div>
        </div>
    </div>
{/if}
