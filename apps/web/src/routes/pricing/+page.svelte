<script lang="ts">
    import { onMount } from "svelte";
    import { apiFetch } from "$lib/api";
    import { Save, AlertCircle, RefreshCw } from "lucide-svelte";
    import { i18n } from "$lib/i18n/index.svelte";

    let isLoading = $state(true);
    let isSaving = $state(false);
    let error: string | null = $state(null);
    let successMessage: string | null = $state(null);

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

    async function loadConfig() {
        isLoading = true;
        error = null;
        successMessage = null;
        try {
            const data =
                await apiFetch<Record<string, string>>("/admin/options");

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
        } catch (err: any) {
            error = err.message || "Failed to load pricing options";
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
                // Minify payload to save DB size, or keep it formatted
                payload[c.key] = JSON.stringify(parsed);
            } catch (err: any) {
                error = `Invalid JSON in ${c.title}: ${err.message}`;
                isSaving = false;
                return;
            }
        }

        try {
            await apiFetch("/admin/options", {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            successMessage = "Pricing ratios saved successfully!";
            setTimeout(() => (successMessage = null), 3000);
        } catch (err: any) {
            error = err.message || "Failed to save options";
        } finally {
            isSaving = false;
        }
    }

    onMount(() => {
        loadConfig();
    });
</script>

<svelte:head>
    <title>{i18n.t.nav.pricing} - Elygate</title>
</svelte:head>

<div class="h-full max-w-5xl mx-auto space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h1 class="text-2xl font-bold text-slate-900 dark:text-white">
                {i18n.t.nav.pricing}
            </h1>
            <p class="text-slate-500 dark:text-slate-400 mt-1">
                {i18n.t.pricing.desc}
            </p>
        </div>
        <div class="flex items-center gap-3">
            <button
                onclick={loadConfig}
                class="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800 rounded-lg transition-colors"
                title="Refresh"
            >
                <RefreshCw class="w-5 h-5 {isLoading ? 'animate-spin' : ''}" />
            </button>
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
        </div>
    </div>

    {#if error}
        <div
            class="p-4 bg-rose-50 border border-rose-100 dark:bg-rose-900/20 dark:border-rose-800/50 rounded-xl flex items-start gap-3"
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
        >
            {successMessage}
        </div>
    {/if}

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        {#each configDefinitions as def}
            <div
                class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col"
            >
                <div
                    class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50"
                >
                    <h2
                        class="text-base font-semibold text-slate-900 dark:text-white"
                    >
                        {def.title}
                    </h2>
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

        <!-- Add Info box for formula -->
        <div
            class="bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/30 rounded-2xl p-6 flex flex-col justify-center"
        >
            <h3 class="font-medium text-indigo-900 dark:text-indigo-300 mb-2">
                {i18n.t.pricing.costFormula}
            </h3>
            <div
                class="text-sm font-mono text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/30 p-4 rounded-lg"
            >
                Cost = <br />
                &nbsp;&nbsp;(PromptTokens + <br />
                &nbsp;&nbsp;&nbsp;CompletionTokens * CompletionRatio) <br />
                &nbsp;* ModelRatio <br />
                &nbsp;* GroupRatio <br />
                &nbsp;* GroupModelRatio
            </div>
            <p
                class="text-xs text-indigo-600 dark:text-indigo-500 mt-4 leading-relaxed"
            >
                {i18n.t.pricing.fixedCostNote}
            </p>
        </div>
    </div>
</div>
