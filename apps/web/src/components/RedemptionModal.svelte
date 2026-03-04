<script lang="ts">
    import { X, Save } from "lucide-svelte";
    import { fade, scale } from "svelte/transition";
    import { i18n } from "$lib/i18n/index.svelte";

    import { type Redemption } from "$lib/types";

    let {
        show = false,
        redemption = null,
        onClose = () => {},
        onSave = (data: any) => {},
    } = $props<{
        show: boolean;
        redemption: Redemption | null;
        onClose: () => void;
        onSave: (data: any) => Promise<void>;
    }>();

    // Form state
    let formData = $state({
        name: "",
        key: "",
        quota: 500000,
        count: 1,
        status: 1,
    });

    let isSubmitting = $state(false);
    let error = $state("");

    $effect(() => {
        if (show) {
            if (redemption) {
                formData = {
                    name: redemption.name || "",
                    key: redemption.key || "",
                    quota: redemption.quota ?? 500000,
                    count: redemption.count ?? 1,
                    status: redemption.status ?? 1,
                };
            } else {
                formData = {
                    name: "Top-up Code",
                    key: "",
                    quota: 500000,
                    count: 1,
                    status: 1,
                };
            }
            error = "";
        }
    });

    async function handleSubmit() {
        error = "";
        isSubmitting = true;
        try {
            await onSave({ ...formData });
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="bg-white dark:bg-slate-950 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            transition:scale={{ duration: 200, start: 0.95 }}
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"
            >
                <h3
                    class="text-lg font-semibold text-slate-900 dark:text-white"
                >
                    {redemption ? i18n.t.common.edit : "Generate"} Redemption Code
                </h3>
                <button
                    onclick={onClose}
                    class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <X class="w-5 h-5" />
                </button>
            </div>

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

                <div class="space-y-1.5">
                    <label
                        for="r-name"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >Name / Note</label
                    >
                    <input
                        id="r-name"
                        bind:value={formData.name}
                        placeholder="e.g. VIP Gift"
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-1.5">
                    <label
                        for="r-key"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >Specific Key (Leave blank to auto-generate)</label
                    >
                    <input
                        id="r-key"
                        bind:value={formData.key}
                        placeholder="elygate-xxx"
                        disabled={!!redemption}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 disabled:text-slate-400 dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label
                            for="r-quota"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >Quota (Value)</label
                        >
                        <input
                            id="r-quota"
                            type="number"
                            bind:value={formData.quota}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">500,000 = $0.5</p>
                    </div>
                    <div class="space-y-1.5">
                        <label
                            for="r-uses"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >Max Uses</label
                        >
                        <input
                            id="r-uses"
                            type="number"
                            bind:value={formData.count}
                            disabled={!!redemption && redemption.used_count > 0}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>

                <div class="space-y-1.5 pt-2">
                    <label
                        for="rd-status"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >Status</label
                    >
                    <select
                        id="rd-status"
                        bind:value={formData.status}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        <option value={1}>Active</option>
                        <option value={2}>Disabled / Exhausted</option>
                    </select>
                </div>
            </div>

            <div
                class="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50"
            >
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
{/if}
