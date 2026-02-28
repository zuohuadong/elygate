<script lang="ts">
    // 这是一个基于 Svelte 5 Runes ($props) 封装的极简高级感 Table
    // 设计参考 shadcn-svelte 的风格，但不依赖第三方重型结构

    type Column = {
        key: string;
        label: string;
        render?: (value: any, row: any) => any; // 支持自定义渲染如 Badge
    };

    let {
        data = [],
        columns = [],
        onEdit = (row: any) => {},
        onDelete = (row: any) => {},
    }: {
        data: any[];
        columns: Column[];
        onEdit?: (row: any) => void;
        onDelete?: (row: any) => void;
    } = $props();
</script>

<div
    class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm"
>
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
                    <!-- 统一的操作列插槽 -->
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
                {#each data as row, i}
                    <tr
                        class="hover:bg-slate-50/80 dark:hover:bg-slate-900/80 transition-colors duration-150 group"
                    >
                        {#each columns as col}
                            <td
                                class="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-slate-300"
                            >
                                {#if col.render}
                                    <!-- 此处 Svelte 5 snippets 会更优雅，作为演示我们使用函数 render -->
                                    {@html col.render(row[col.key], row)}
                                {:else}
                                    {row[col.key]}
                                {/if}
                            </td>
                        {/each}

                        <!-- 通用的末尾操作插槽：此处我们写死常用的操作按钮供预览 -->
                        <td
                            class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium"
                        >
                            <button
                                onclick={() => onEdit(row)}
                                class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 transition-colors mr-3 opacity-0 group-hover:opacity-100"
                                >编辑</button
                            >
                            <button
                                onclick={() => onDelete(row)}
                                class="text-rose-600 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-300 transition-colors opacity-0 group-hover:opacity-100"
                                >删除</button
                            >
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

    <!-- 分页栏占位 -->
    <div
        class="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30"
    >
        <span class="text-xs text-slate-500 dark:text-slate-400">
            显示 {data.length > 0 ? 1 : 0} 到 {data.length} 条记录
        </span>
        <div
            class="inline-flex rounded-md shadow-sm opacity-50 pointer-events-none"
        >
            <button
                class="px-3 py-1.5 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-l-md hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
                >上一页</button
            >
            <button
                class="px-3 py-1.5 text-sm font-medium text-slate-500 bg-white border border-l-0 border-slate-200 rounded-r-md hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
                >下一页</button
            >
        </div>
    </div>
</div>
