<script lang="ts">
    import { Calculator } from "lucide-svelte";
    import { i18n } from "$lib/i18n/index.svelte";
    import { session } from "$lib/session.svelte";

    let {
        quotaPerUnit = session.quotaPerUnit,
        exchangeRate = session.exchangeRate,
        onConvert = (quota: number) => {},
    } = $props<{
        quotaPerUnit?: number;
        exchangeRate?: number;
        onConvert?: (quota: number) => void;
    }>();

    let inputValue = $state("");
    let inputCurrency = $state<"USD" | "RMB">("USD");
    let resultQuota = $state<number | null>(null);

    function convert() {
        const amount = parseFloat(inputValue);
        if (isNaN(amount) || amount <= 0) {
            resultQuota = null;
            return;
        }

        let usdAmount: number;
        if (inputCurrency === "RMB") {
            usdAmount = amount / exchangeRate;
        } else {
            usdAmount = amount;
        }

        resultQuota = Math.round(usdAmount * quotaPerUnit);
    }

    function applyResult() {
        if (resultQuota !== null && resultQuota > 0) {
            onConvert(resultQuota);
        }
    }

    $effect(() => {
        convert();
    });
</script>

<div class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
    <div class="flex items-center gap-2 mb-3">
        <Calculator class="w-4 h-4 text-indigo-500" />
        <span class="text-sm font-medium text-slate-700 dark:text-slate-300">
            {i18n.lang === "zh" ? "额度换算工具" : "Quota Calculator"}
        </span>
    </div>
    
    <div class="flex items-center gap-2">
        <input
            type="number"
            bind:value={inputValue}
            placeholder={i18n.lang === "zh" ? "输入金额" : "Enter amount"}
            class="flex-1 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
        />
        <select
            bind:value={inputCurrency}
            class="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
        >
            <option value="USD">USD ($)</option>
            <option value="RMB">RMB (¥)</option>
        </select>
    </div>

    {#if resultQuota !== null && resultQuota > 0}
        <div class="mt-3 flex items-center justify-between">
            <div class="text-sm">
                <span class="font-medium text-slate-900 dark:text-white">{resultQuota.toLocaleString()}</span>
                <span class="text-slate-500 dark:text-slate-400 ml-1">quota</span>
                <span class="text-slate-400 dark:text-slate-500 ml-1">
                    ({inputCurrency === "USD" ? "$" : "¥"}{inputValue} = ${(resultQuota / quotaPerUnit).toFixed(4)})
                </span>
            </div>
            <button
                onclick={applyResult}
                class="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
                {i18n.lang === "zh" ? "应用" : "Apply"}
            </button>
        </div>
    {/if}

    <div class="mt-2 text-xs text-slate-400">
        $1 = {quotaPerUnit.toLocaleString()} quota | ¥1 = {Math.round(quotaPerUnit / exchangeRate).toLocaleString()} quota
    </div>
</div>
