<script lang="ts">
    import { onMount } from 'svelte';
    import { apiFetch } from '$lib/api';
    import { i18n } from '$lib/i18n/index.svelte';

    let data = $state<any[]>([]);
    let isLoading = $state(true);

    onMount(async () => {
        try {
            const res = await apiFetch<any[]>('/admin/dashboard/latency-heatmap');
            data = res || [];
        } catch (e) {
            console.error('Failed to load heatmap:', e);
        } finally {
            isLoading = false;
        }
    });

    const hours = Array.from({ length: 24 }, (_, i) => i);
    
    function getColor(ms: number) {
        if (!ms) return 'bg-slate-100 dark:bg-slate-800';
        if (ms < 500) return 'bg-emerald-400';
        if (ms < 1500) return 'bg-amber-400';
        return 'bg-rose-400';
    }
</script>

<div class="glass-card">
    <h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">
        {i18n.lang === 'zh' ? '24小时延迟热力图' : '24H Latency Heatmap'}
    </h3>
    
    {#if isLoading}
        <div class="h-32 flex items-center justify-center">
            <div class="animate-pulse text-slate-400 text-xs">Loading metrics...</div>
        </div>
    {:else}
        <div class="grid grid-cols-12 gap-1">
            {#each hours as h}
                {@const avg = data.find(d => d.hour === h)?.latency}
                <div 
                    class="h-10 rounded-sm {getColor(avg)} transition-all hover:scale-110 cursor-help relative group"
                    title={`${h}:00 - ${avg ? Math.round(avg) + 'ms' : 'No Data'}`}
                >
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded z-10 whitespace-nowrap">
                        {h}:00 ({avg ? Math.round(avg) + 'ms' : 'N/A'})
                    </div>
                </div>
            {/each}
        </div>
        <div class="mt-4 flex justify-between text-[10px] text-slate-500 font-mono">
            <span>Fast (&lt;500ms)</span>
            <span>Slow (&gt;1500ms)</span>
        </div>
    {/if}
</div>
