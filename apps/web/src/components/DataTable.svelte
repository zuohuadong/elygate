<script lang="ts">
    import { Search } from "lucide-svelte";

    type Column = {
        key: string;
        label: string;
        render?: (value: any, row: any) => unknown; // Supports custom rendering like Badge
    };

    let {
        data = [],
        columns = [],
        onEdit = undefined,
        onDelete = undefined,
        extraActions = [],
        pageSize = 10,
        currentPage = 1,
        total = 0,
        onPageChange = (page: number) => {},
        searchable = true,
        customActions,
        cell,
    }: {
        data: Record<string, any>[];
        columns: Column[];
        onEdit?: (row: Record<string, any>) => void;
        onDelete?: (row: Record<string, any>) => void;
        extraActions?: { label: string; class: string; onClick: (row: Record<string, any>) => void }[];
        pageSize?: number;
        currentPage?: number;
        total?: number;
        onPageChange?: (page: number) => void;
        searchable?: boolean;
        customActions?: import('svelte').Snippet<[any]>;
        cell?: import('svelte').Snippet<[string, any, any]>;
    } = $props();

    let searchTerm = $state("");

    // Local filtering if no server-side "total" is provided, or if specifically desired
    const filteredData = $derived.by(() => {
        if (!searchTerm) return data;
        const lowSearch = searchTerm.toLowerCase();
        return data.filter(item => 
            Object.values(item).some(val => 
                String(val).toLowerCase().includes(lowSearch)
            )
        );
    });

    const effectiveTotal = $derived(total || (searchTerm ? filteredData.length : data.length));
    const effectiveData = $derived(total > 0 ? data : filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize));

    // Calculate pagination
    const totalPages = $derived(Math.ceil(effectiveTotal / pageSize) || 1);
    const startItem = $derived(effectiveTotal === 0 ? 0 : (currentPage - 1) * pageSize + 1);
    const endItem = $derived(Math.min(currentPage * pageSize, effectiveTotal));

    // Pagination controls
    function goToPage(page: number) {
        if (page >= 1 && page <= totalPages) {
            onPageChange(page);
        }
    }

    function goToPrevious() {
        goToPage(currentPage - 1);
    }

    function goToNext() {
        goToPage(currentPage + 1);
    }
</script>

<div
    class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm"
>
    {#if searchable}
    <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30">
        <div class="relative max-w-sm">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search class="h-4 w-4 text-slate-400" />
            </div>
            <input
                type="text"
                bind:value={searchTerm}
                oninput={() => { if(currentPage !== 1) onPageChange(1); }}
                placeholder="Search..."
                class="block w-full pl-10 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
        </div>
    </div>
    {/if}

    <div class="overflow-x-auto">
        <table class="w-full text-sm text-left">
            <thead
                class="text-xs text-slate-500 uppercase bg-slate-50/50 dark:bg-slate-900/50 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800"
            >
                <tr>
                    {#each columns as col}
                        <th
                            scope="col"
                            class="px-6 py-4 font-medium tracking-wider"
                        >
                            {col.label}
                        </th>
                    {/each}
                    <th
                        scope="col"
                        class="px-6 py-4 text-right font-medium tracking-wider"
                    >
                        操作
                    </th>
                </tr>
            </thead>
            <tbody
                class="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950"
            >
                {#each effectiveData as row, i}
                    <tr
                        class="hover:bg-slate-50/80 dark:hover:bg-slate-900/80 transition-colors duration-150 group"
                    >
                        {#each columns as col}
                            <td
                                class="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-slate-300"
                            >
                                {#if cell}
                                    {@render cell(col.key, row[col.key], row)}
                                {:else if col.render}
                                    {@html col.render(row[col.key], row)}
                                {:else}
                                    {row[col.key]}
                                {/if}
                            </td>
                        {/each}

                        <td
                            class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium"
                        >
                            {#if customActions}
                                {@render customActions(row)}
                            {/if}
                            {#each extraActions as action}
                                <button
                                    onclick={() => action.onClick(row)}
                                    class="{action.class} mr-3 opacity-0 group-hover:opacity-100 transition-colors"
                                >{action.label}</button>
                            {/each}
                            {#if onEdit}
                            <button
                                onclick={() => onEdit(row)}
                                class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 transition-colors mr-3 opacity-0 group-hover:opacity-100"
                                >编辑</button
                            >
                            {/if}
                            {#if onDelete}
                            <button
                                onclick={() => onDelete(row)}
                                class="text-rose-600 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-300 transition-colors opacity-0 group-hover:opacity-100"
                                >删除</button
                            >
                            {/if}
                        </td>
                    </tr>
                {:else}
                    <tr>
                        <td
                            colspan={columns.length + 1}
                            class="px-6 py-10 text-center text-slate-500 dark:text-slate-400"
                        >
                            暂无相关数据
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    <!-- Pagination Bar -->
    <div
        class="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30"
    >
        <span class="text-xs text-slate-500 dark:text-slate-400">
            {#if effectiveTotal > 0}
                显示 {startItem} 到 {endItem} 条，共 {effectiveTotal} 条记录
            {:else}
                暂无数据
            {/if}
        </span>
        <div class="flex items-center gap-2">
            <span class="text-xs text-slate-500 dark:text-slate-400">
                第 {currentPage} / {totalPages} 页
            </span>
            <div class="inline-flex rounded-md shadow-sm">
                <button
                    onclick={goToPrevious}
                    disabled={currentPage <= 1}
                    class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-l-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                    上一页
                </button>
                <button
                    onclick={goToNext}
                    disabled={currentPage >= totalPages}
                    class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-l-0 border-slate-200 rounded-r-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                    下一页
                </button>
            </div>
        </div>
    </div>
</div>
