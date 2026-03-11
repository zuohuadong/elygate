<script lang="ts">
    import { X, Save, Calculator, DollarSign, Coins } from "lucide-svelte";
    import { fade, scale } from "svelte/transition";
    import { i18n } from "$lib/i18n/index.svelte";
    import { session } from "$lib/session.svelte";
    import QuotaCalculator from "./QuotaCalculator.svelte";

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

    // Derived/Local conversion state for UI
    let usd = $state(0);
    let rmb = $state(0);

    function syncFromQuota(q: number) {
        usd = Number((q / session.quotaPerUnit).toFixed(4));
        rmb = Number((usd * session.exchangeRate).toFixed(2));
    }

    function syncFromUSD(u: number) {
        formData.quota = Math.round(u * session.quotaPerUnit);
        rmb = Number((u * session.exchangeRate).toFixed(2));
    }

    function syncFromRMB(r: number) {
        usd = Number((r / session.exchangeRate).toFixed(4));
        formData.quota = Math.round(usd * session.quotaPerUnit);
    }

    let isSubmitting = $state(false);
    let error = $state("");
    let showCalculator = $state(false);

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
                    name: i18n.lang === 'zh' ? "额度充值码" : "Top-up Code",
                    key: "",
                    quota: 500000,
                    count: 1,
                    status: 1,
                };
            }
            syncFromQuota(formData.quota);
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

    function applyQuota(quota: number) {
        formData.quota = quota;
        syncFromQuota(quota);
        showCalculator = false;
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
                    {redemption ? i18n.t.common.edit : i18n.t.redemptions.generateCode}
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
                        >{i18n.t.redemptions.nameNote}</label
                    >
                    <input
                        id="r-name"
                        bind:value={formData.name}
                        placeholder={i18n.t.redemptions.namePlaceholder}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-1.5">
                    <label
                        for="r-key"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.redemptions.specificKey}</label
                    >
                    <input
                        id="r-key"
                        bind:value={formData.key}
                        placeholder="elygate-xxx"
                        disabled={!!redemption}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 disabled:text-slate-400 dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-4 pt-2">
                    <!-- Quota Input -->
                    <div class="space-y-1.5">
                        <label
                            for="r-quota"
                            class="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2"
                        >
                            <Calculator class="w-4 h-4 text-indigo-500" />
                            {i18n.t.redemptions.quotaHelp}
                        </label>
                        <div class="relative">
                            <input
                                id="r-quota"
                                type="number"
                                bind:value={formData.quota}
                                oninput={(e) => syncFromQuota(Number(e.currentTarget.value))}
                                class="w-full pl-3 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                            <div class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase">
                                Qta
                            </div>
                        </div>
                    </div>

                    <!-- Currency Conversion Grid -->
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1.5">
                            <label
                                for="r-usd"
                                class="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5"
                            >
                                <DollarSign class="w-3.5 h-3.5 text-emerald-500" />
                                {i18n.t.redemptions.usdAmount}
                            </label>
                            <div class="relative">
                                <input
                                    id="r-usd"
                                    type="number"
                                    step="0.01"
                                    bind:value={usd}
                                    oninput={(e) => syncFromUSD(Number(e.currentTarget.value))}
                                    class="w-full pl-3 pr-8 py-2 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                                <div class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">
                                    USD
                                </div>
                            </div>
                        </div>

                        <div class="space-y-1.5">
                            <label
                                for="r-rmb"
                                class="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5"
                            >
                                <Coins class="w-3.5 h-3.5 text-amber-500" />
                                {i18n.t.redemptions.rmbAmount}
                            </label>
                            <div class="relative">
                                <input
                                    id="r-rmb"
                                    type="number"
                                    step="0.01"
                                    bind:value={rmb}
                                    oninput={(e) => syncFromRMB(Number(e.currentTarget.value))}
                                    class="w-full pl-3 pr-8 py-2 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                                <div class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">
                                    RMB
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-indigo-50/50 dark:bg-indigo-500/5 rounded-lg p-3 border border-indigo-100/50 dark:border-indigo-500/10">
                        <p class="text-[11px] text-indigo-600 dark:text-indigo-400 leading-relaxed font-medium">
                            {i18n.t.redemptions.conversionNotice.replace('{rate}', session.exchangeRate.toString())}
                            <br/>
                            1 USD = {session.quotaPerUnit.toLocaleString()} Quota
                        </p>
                    </div>

                    <div class="space-y-1.5 pt-2">
                        <label
                            for="r-uses"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.redemptions.maxUses}</label
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
                        >{i18n.t.redemptions.status}</label
                    >
                    <select
                        id="rd-status"
                        bind:value={formData.status}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        <option value={1}>{i18n.t.redemptions.active}</option>
                        <option value={2}>{i18n.t.redemptions.disabled}</option>
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
