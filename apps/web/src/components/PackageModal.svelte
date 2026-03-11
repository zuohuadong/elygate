<script lang="ts">
    import { X, ShoppingBag } from "lucide-svelte";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount, untrack } from "svelte";
    import { apiFetch } from "$lib/api";

    let { show, pkg = null, onClose, onSave } = $props();

    let formData = $state({
        name: "",
        description: "",
        price: 0,
        durationDays: 30,
        models: "",
        defaultRateLimitId: "",
        modelRateLimitsJson: "{}",
        isPublic: true
    });

    let rateLimits = $state<any[]>([]);

    onMount(async () => {
        try {
            rateLimits = await apiFetch<any[]>("/admin/rate-limits");
        } catch (e) {
            console.error("Failed to load rate limits", e);
        }
    });

    $effect(() => {
        if (show) {
            untrack(() => {
                if (pkg) {
                    formData = {
                        name: pkg.name || "",
                        description: pkg.description || "",
                        price: pkg.price || 0,
                        durationDays: pkg.duration_days || 30,
                        models: Array.isArray(pkg.models) ? pkg.models.join(",") : (pkg.models || ""),
                        defaultRateLimitId: pkg.default_rate_limit_id ? String(pkg.default_rate_limit_id) : "",
                        modelRateLimitsJson: pkg.model_rate_limits ? JSON.stringify(pkg.model_rate_limits, null, 2) : "{}",
                        isPublic: pkg.is_public ?? true
                    };
                } else {
                    formData = {
                        name: "",
                        description: "",
                        price: 0,
                        durationDays: 30,
                        models: "",
                        defaultRateLimitId: "",
                        modelRateLimitsJson: "{}",
                        isPublic: true
                    };
                }
            });
        }
    });

    function handleSubmit(e: Event) {
        e.preventDefault();
        
        // Parse models string back to array
        const modelsArray = formData.models ? formData.models.split(',').map(s => s.trim()).filter(Boolean) : [];
        
        // Parse JSON for modelRateLimits
        let parsedModelRateLimits = {};
        try {
            parsedModelRateLimits = JSON.parse(formData.modelRateLimitsJson);
        } catch (error) {
            alert(i18n.lang === 'zh' ? '专属限流方案 JSON 格式错误' : 'Invalid JSON for Model Rate Limits');
            return;
        }

        const payload = {
            name: formData.name,
            description: formData.description,
            price: Number(formData.price),
            durationDays: Number(formData.durationDays),
            models: modelsArray,
            defaultRateLimitId: formData.defaultRateLimitId ? Number(formData.defaultRateLimitId) : null,
            modelRateLimits: parsedModelRateLimits,
            isPublic: formData.isPublic
        };
        
        onSave(payload);
    }
</script>

{#if show}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
        <div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onclick={(e) => e.target === e.currentTarget && onClose()}></div>
        <div class="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-800 animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <ShoppingBag class="w-5 h-5 text-indigo-500" />
                    {pkg ? i18n.t.packages.edit : i18n.t.packages.add}
                </h3>
                <button onclick={onClose} class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                    <X class="w-5 h-5" />
                </button>
            </div>

            <form onsubmit={handleSubmit} class="p-6 space-y-5 overflow-y-auto">
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="col-span-2">
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {i18n.t.packages.name} <span class="text-rose-500">*</span>
                            </label>
                            <input type="text" bind:value={formData.name} required placeholder={i18n.t.packages.namePlaceholder} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors placeholder:text-slate-400" />
                        </div>
                        
                        <div class="col-span-2">
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {i18n.t.packages.description}
                            </label>
                            <input type="text" bind:value={formData.description} placeholder={i18n.t.packages.descriptionPlaceholder} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors placeholder:text-slate-400" />
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {i18n.t.packages.price} <span class="text-xs text-slate-400">{i18n.t.packages.priceUnit}</span> <span class="text-rose-500">*</span>
                            </label>
                            <input type="number" step="0.01" min="0" bind:value={formData.price} required class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {i18n.t.packages.duration} <span class="text-xs text-slate-400">{i18n.t.packages.durationUnit}</span> <span class="text-rose-500">*</span>
                            </label>
                            <input type="number" min="1" bind:value={formData.durationDays} required class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors" />
                        </div>

                        <div class="col-span-2">
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {i18n.t.packages.models} <span class="text-xs text-slate-400">{i18n.t.packages.modelsTip}</span> <span class="text-rose-500">*</span>
                            </label>
                            <input type="text" bind:value={formData.models} required placeholder={i18n.t.packages.modelsPlaceholder} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors font-mono" />
                        </div>

                        <div class="col-span-2">
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {i18n.t.packages.defaultRateLimit}
                            </label>
                            <select bind:value={formData.defaultRateLimitId} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors">
                                <option value="">{i18n.t.packages.noLimit}</option>
                                {#each rateLimits as rule}
                                    <option value={String(rule.id)}>{rule.name} (RPM:{rule.rpm} RPH:{rule.rph} Concurrent:{rule.concurrent})</option>
                                {/each}
                            </select>
                        </div>

                        <div class="col-span-2">
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {i18n.t.packages.modelRateLimits}
                            </label>
                            <textarea bind:value={formData.modelRateLimitsJson} rows="3" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors font-mono" placeholder='"gpt-4o": 2, "claude-3-5-sonnet": 3'></textarea>
                            <p class="text-xs text-slate-500 mt-1">
                                {i18n.t.packages.modelRateLimitsTip} <code>{i18n.t.packages.modelRateLimitsFormat}</code>
                            </p>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 pt-2">
                        <input type="checkbox" id="pkg-public" bind:checked={formData.isPublic} class="w-4 h-4 text-indigo-600 bg-slate-100 border-slate-300 rounded focus:ring-indigo-500 dark:focus:ring-indigo-600 dark:ring-offset-slate-900 dark:bg-slate-800 dark:border-slate-700" />
                        <label for="pkg-public" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {i18n.t.packages.isPublic}
                        </label>
                    </div>
                </div>

                <div class="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800 shrink-0">
                    <button type="button" onclick={onClose} class="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm focus:ring-2 focus:ring-slate-500/20">
                        {i18n.t.common.cancel}
                    </button>
                    <button type="submit" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900">
                        {i18n.t.common.save}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}
