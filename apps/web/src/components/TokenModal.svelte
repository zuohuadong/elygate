<script lang="ts">
    import { X, Save, Key } from "lucide-svelte";
    import { fade, scale } from "svelte/transition";
    import { i18n } from "$lib/i18n";

    let {
        show = false,
        token = null,
        onClose = () => {},
        onSave = (data: any) => {},
    } = $props<{
        show: boolean;
        token: any | null;
        onClose: () => void;
        onSave: (data: any) => Promise<void>;
    }>();

    let formData = $state({
        name: "",
        remainQuota: 1000000,
        expiredAt: -1,
        status: 1,
    });

    let isSubmitting = $state(false);
    let error = $state("");

    $effect(() => {
        if (show) {
            if (token) {
                formData = {
                    name: token.name || "",
                    remainQuota: token.remainQuota || 0,
                    expiredAt: token.expiredAt || -1,
                    status: token.status || 1,
                };
            } else {
                formData = {
                    name: "",
                    remainQuota: 1000000,
                    expiredAt: -1,
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
            await onSave(formData);
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
            class="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            transition:scale={{ duration: 200, start: 0.95 }}
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"
            >
                <h3
                    class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2"
                >
                    <Key class="w-5 h-5 text-indigo-500" />
                    {token ? i18n.t.common.edit : i18n.t.tokens.add}
                </h3>
                <button
                    onclick={onClose}
                    class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <X class="w-5 h-5" />
                </button>
            </div>

            <div class="px-6 py-6 space-y-4 text-left">
                {#if error}
                    <div
                        class="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-lg border border-rose-100 dark:border-rose-800/50"
                    >
                        {error}
                    </div>
                {/if}

                <div class="space-y-1.5">
                    <label
                        for="tk-name"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.tokens.name}</label
                    >
                    <input
                        id="tk-name"
                        bind:value={formData.name}
                        placeholder="e.g. Test Key"
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-1.5">
                    <label
                        for="tk-quota"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.tokens.quota} (1000 = $1.00)</label
                    >
                    <div class="relative">
                        <span
                            class="absolute left-3 top-2 text-slate-400 text-sm"
                            >$</span
                        >
                        <input
                            id="tk-quota"
                            type="number"
                            value={formData.remainQuota}
                            oninput={(e) =>
                                (formData.remainQuota = Number(
                                    e.currentTarget.value,
                                ))}
                            class="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <div class="mt-1 flex gap-2">
                            <button
                                onclick={() => (formData.remainQuota = -1)}
                                class="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                                >{i18n.lang === "zh"
                                    ? "设为无限"
                                    : "Unlimited"}</button
                            >
                            <button
                                onclick={() =>
                                    (formData.remainQuota += 1000000)}
                                class="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                                >+ $1000</button
                            >
                        </div>
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label
                        for="tk-expire"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.lang === "zh"
                            ? "过期时间 (-1 为永不过期)"
                            : "Expiration (-1 for never)"}</label
                    >
                    <input
                        id="tk-expire"
                        type="number"
                        bind:value={formData.expiredAt}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-1.5">
                    <label
                        for="tk-status"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.tokens.status}</label
                    >
                    <select
                        id="tk-status"
                        bind:value={formData.status}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        <option value={1}
                            >{i18n.lang === "zh" ? "正常" : "Active"}</option
                        >
                        <option value={2}
                            >{i18n.lang === "zh"
                                ? "禁用/封禁"
                                : "Banned"}</option
                        >
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
