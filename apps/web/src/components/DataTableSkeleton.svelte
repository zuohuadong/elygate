<script lang="ts">
    import Skeleton from './Skeleton.svelte';

    let { 
        rows = 5,
        columns = 4
    } = $props();
</script>

<div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
    <!-- Header -->
    <div class="flex items-center gap-4 px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        {#each Array(columns) as _}
            <div class="flex-1">
                <Skeleton height="0.875rem" width="60%" />
            </div>
        {/each}
    </div>
    <!-- Rows -->
    {#each Array(rows) as _}
        <div class="flex items-center gap-4 px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
            {#each Array(columns) as _}
                <div class="flex-1">
                    <Skeleton height="1rem" width="80%" />
                </div>
            {/each}
        </div>
    {/each}
</div>
