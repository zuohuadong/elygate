<script lang="ts">
    import { X, Gift } from "lucide-svelte";
    import { i18n } from "$lib/i18n/index.svelte";
    

    import { apiFetch } from "$lib/api";

    let { show, user = null, onClose, onSave } = $props();

    let packages = $state<any[]>([]);
    let selectedPackageId = $state("");
    let isSubmitting = $state(false);
    let loadError = $state("");

    $effect(() => { (async () => {
        try {
            packages = await apiFetch<any[]>("/admin/packages");
        } catch (e: unknown) {
            loadError = e instanceof Error ? e instanceof Error ? e.message : String(e) : "Failed to load packages";
        }
    })(); });

    $effect(() => {
        if (show) {
            selectedPackageId = "";
            isSubmitting = false;
        }
    });

    async function handleSubmit(e: Event) {
        e.preventDefault();
        if (!selectedPackageId || !user) return;
        
        isSubmitting = true;
        try {
            await apiFetch(`/admin/users/${user.id}/subscriptions`, {
                method: "POST",
                body: JSON.stringify({ packageId: Number(selectedPackageId) })
            });
            onSave();
        } catch (e: unknown) {
            alert(i18n.t.common.failed + ": " + (e instanceof Error ? e.message : String(e)));
        } finally {
            isSubmitting = false;
        }
    }

    let isBackdropMouseDown = $state(false);
    function handleMouseDown(e: MouseEvent) {
        isBackdropMouseDown = e.target === e.currentTarget;
    }
</script>

{#if show}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
        <div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" 
             onmousedown={handleMouseDown}
             onclick={(e) => e.target === e.currentTarget && isBackdropMouseDown && onClose()}
             role="button"
             aria-label="Close modal"
             tabindex="-1"></div>
        <div class="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden ring-1 ring-slate-200 dark:ring-slate-800 animate-in fade-in zoom-in-95 duration-200"
             role="dialog"
             aria-modal="true">
            <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Gift class="w-5 h-5 text-indigo-500" />
                    {i18n.lang === 'zh' ? '派发套餐' : 'Grant Package'}
                </h3>
                <button onclick={onClose} class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                    <X class="w-5 h-5" />
                </button>
            </div>

            <form onsubmit={handleSubmit} class="p-6 space-y-5">
                {#if user}
                    <div class="p-4 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
                        <p class="text-sm font-medium text-indigo-900 dark:text-indigo-300">
                            {i18n.lang === 'zh' ? '目标用户：' : 'Target User: '} <span class="font-bold">{user.username}</span> (ID: {user.id})
                        </p>
                    </div>
                {/if}

                {#if loadError}
                    <p class="text-sm text-rose-500">{loadError}</p>
                {:else}
                    <div>
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {i18n.lang === 'zh' ? '选择套餐' : 'Select Package'} <span class="text-rose-500">*</span>
                        </label>
                        <div class="space-y-2 max-h-48 overflow-y-auto pr-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2">
                            {#each packages as pkg}
                                <label class="flex items-start p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-500/10">
                                    <input type="radio" name="package" value={String(pkg.id)} bind:group={selectedPackageId} class="mt-1 flex-shrink-0 text-indigo-600 focus:ring-indigo-500" required />
                                    <div class="ml-3 text-sm">
                                        <div class="font-medium text-slate-900 dark:text-white">{pkg.name}</div>
                                        {#if pkg.description}
                                            <p class="text-slate-500 dark:text-slate-400 mt-0.5">{pkg.description}</p>
                                        {/if}
                                        <div class="flex gap-3 mt-2 text-xs text-slate-500">
                                            <span>${Number(pkg.price).toFixed(2)}</span>
                                            <span>|</span>
                                            <span>{pkg.duration_days} {i18n.lang === 'zh' ? '天有效' : 'days'}</span>
                                        </div>
                                    </div>
                                </label>
                            {:else}
                                <p class="text-sm text-slate-500 p-2">
                                    {i18n.lang === 'zh' ? '暂无可供派发的套餐，请先在前台创建。' : 'No packages available. Create one first.'}
                                </p>
                            {/each}
                        </div>
                    </div>
                {/if}

                <div class="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800">
                    <button type="button" onclick={onClose} class="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm focus:ring-2 focus:ring-slate-500/20">
                        {i18n.t.common?.cancel || 'Cancel'}
                    </button>
                    <button type="submit" disabled={isSubmitting || !selectedPackageId} class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed">
                        {isSubmitting ? (i18n.lang === 'zh' ? '提交中...' : 'Saving...') : (i18n.lang === 'zh' ? '确认发放' : 'Grant')}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}
