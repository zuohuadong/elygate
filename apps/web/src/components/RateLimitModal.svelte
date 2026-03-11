<script lang="ts">
    import { X, ShieldAlert } from "lucide-svelte";
    import { untrack } from "svelte";
    import { i18n } from "$lib/i18n/index.svelte";

    let { show, rateLimit = null, onClose, onSave } = $props();

    let formData = $state({
        name: "",
        rpm: 0,
        rph: 0,
        concurrent: 0
    });

    $effect(() => {
        if (show) {
            untrack(() => {
                if (rateLimit) {
                    formData = {
                        name: rateLimit.name || "",
                        rpm: rateLimit.rpm || 0,
                        rph: rateLimit.rph || 0,
                        concurrent: rateLimit.concurrent || 0
                    };
                } else {
                    formData = {
                        name: "",
                        rpm: 0,
                        rph: 0,
                        concurrent: 0
                    };
                }
            });
        }
    });

    function handleSubmit(e: Event) {
        e.preventDefault();
        onSave(formData);
    }
</script>

{#if show}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
        <div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onclick={(e) => e.target === e.currentTarget && onClose()}></div>
        <div class="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden ring-1 ring-slate-200 dark:ring-slate-800 animate-in fade-in zoom-in-95 duration-200">
            <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldAlert class="w-5 h-5 text-indigo-500" />
                    {rateLimit ? (i18n.lang === 'zh' ? '编辑限流规则' : 'Edit Rate Limit') : (i18n.lang === 'zh' ? '新建限流规则' : 'New Rate Limit')}
                </h3>
                <button onclick={onClose} class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                    <X class="w-5 h-5" />
                </button>
            </div>

            <form onsubmit={handleSubmit} class="p-6 space-y-5">
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {i18n.lang === 'zh' ? '规则名称' : 'Rule Name'} <span class="text-rose-500">*</span>
                        </label>
                        <input type="text" bind:value={formData.name} required placeholder="e.g. GPT-4 Limited" class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors placeholder:text-slate-400" />
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                RPM <span class="text-xs text-slate-400">({i18n.lang === 'zh' ? '次/分钟' : 'req/min'})</span>
                            </label>
                            <input type="number" min="0" bind:value={formData.rpm} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                RPH <span class="text-xs text-slate-400">({i18n.lang === 'zh' ? '次/小时' : 'req/hour'})</span>
                            </label>
                            <input type="number" min="0" bind:value={formData.rph} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors" />
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {i18n.lang === 'zh' ? '并发限制' : 'Concurrent Limit'} <span class="text-xs text-slate-400">({i18n.lang === 'zh' ? '0为无限制' : '0=unlimited'})</span>
                        </label>
                        <input type="number" min="0" bind:value={formData.concurrent} class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors" />
                    </div>
                </div>

                <div class="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800">
                    <button type="button" onclick={onClose} class="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm focus:ring-2 focus:ring-slate-500/20">
                        {i18n.t.common?.cancel || 'Cancel'}
                    </button>
                    <button type="submit" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900">
                        {i18n.t.common?.save || 'Save'}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}
