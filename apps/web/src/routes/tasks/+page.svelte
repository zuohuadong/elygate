<script lang="ts">
    import { ListTodo, Play, Pause, RotateCcw, Trash2, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    

    interface Task {
        id: number;
        type: string;
        name: string;
        description: string;
        status: number;
        priority: number;
        progress: number;
        total_items: number;
        processed_items: number;
        result: unknown;
        error_message: string;
        created_by: number;
        started_at: string;
        completed_at: string;
        created_at: string;
        updated_at: string;
    }

    let tasks = $state<Task[]>([]);
    let isLoading = $state(true);
    let filterStatus = $state("all");
    let filterType = $state("all");

    const statusMap: Record<number, { label: string; labelEn: string; color: string; icon: unknown }> = {
        0: { label: "等待中", labelEn: "Pending", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400", icon: Clock },
        1: { label: "运行中", labelEn: "Running", color: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400", icon: Loader2 },
        2: { label: "已完成", labelEn: "Completed", color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400", icon: CheckCircle },
        3: { label: "失败", labelEn: "Failed", color: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400", icon: XCircle },
        4: { label: "已取消", labelEn: "Cancelled", color: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400", icon: AlertCircle },
    };

    const typeMap: Record<string, { label: string; labelEn: string }> = {
        data_export: { label: "数据导出", labelEn: "Data Export" },
        data_import: { label: "数据导入", labelEn: "Data Import" },
        cache_clear: { label: "缓存清理", labelEn: "Cache Clear" },
        batch_operation: { label: "批量操作", labelEn: "Batch Operation" },
    };

    $effect(() => { loadTasks(); });

    async function loadTasks() {
        isLoading = true;
        try {
            const params = new URLSearchParams();
            if (filterStatus !== "all") params.append("status", filterStatus);
            if (filterType !== "all") params.append("type", filterType);
            
            const data = await apiFetch<Task[]>(`/admin/tasks?${params.toString()}`);
            tasks = data || [];
        } catch (e) {
            console.error("Failed to load tasks:", e);
        } finally {
            isLoading = false;
        }
    }

    $effect(() => {
        if (filterStatus || filterType) loadTasks();
    });

    function getStatusInfo(status: number) {
        return statusMap[status] || statusMap[0];
    }

    function getTypeInfo(type: string) {
        return typeMap[type] || { label: type, labelEn: type };
    }

    function formatTime(dateStr: string): string {
        if (!dateStr) return "-";
        const date = new Date(dateStr);
        return date.toLocaleString();
    }

    function formatDuration(start: string, end: string): string {
        if (!start) return "-";
        const startTime = new Date(start).getTime();
        const endTime = end ? new Date(end).getTime() : Date.now();
        const diff = Math.floor((endTime - startTime) / 1000);
        
        if (diff < 60) return `${diff}s`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
        return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
    }

    async function cancelTask(id: number) {
        try {
            await apiFetch(`/admin/tasks/${id}/cancel`, { method: "POST" });
            await loadTasks();
        } catch (e) {
            console.error("Failed to cancel task:", e);
        }
    }

    async function retryTask(id: number) {
        try {
            await apiFetch(`/admin/tasks/${id}/retry`, { method: "POST" });
            await loadTasks();
        } catch (e) {
            console.error("Failed to retry task:", e);
        }
    }

    async function deleteTask(id: number) {
        if (!confirm(i18n.lang === "zh" ? "确定要删除此任务吗？" : "Are you sure you want to delete this task?")) return;
        try {
            await apiFetch(`/admin/tasks/${id}`, { method: "DELETE" });
            await loadTasks();
        } catch (e) {
            console.error("Failed to delete task:", e);
        }
    }

    function getFilteredTasks(): Task[] {
        return tasks.filter(task => {
            if (filterStatus !== "all" && task.status !== parseInt(filterStatus)) return false;
            if (filterType !== "all" && task.type !== filterType) return false;
            return true;
        });
    }
</script>

<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full">
    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <ListTodo class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "任务管理" : "Task Management"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh" ? "管理异步任务和批量操作" : "Manage async tasks and batch operations"}
            </p>
        </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap gap-4">
        <div class="flex items-center gap-2">
            <label class="text-sm text-slate-500">{i18n.lang === "zh" ? "状态" : "Status"}:</label>
            <select
                bind:value={filterStatus}
                class="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm"
            >
                <option value="all">{i18n.lang === "zh" ? "全部" : "All"}</option>
                {#each Object.entries(statusMap) as [key, value]}
                    <option value={key}>{i18n.lang === "zh" ? value.label : value.labelEn}</option>
                {/each}
            </select>
        </div>

        <div class="flex items-center gap-2">
            <label class="text-sm text-slate-500">{i18n.lang === "zh" ? "类型" : "Type"}:</label>
            <select
                bind:value={filterType}
                class="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm"
            >
                <option value="all">{i18n.lang === "zh" ? "全部" : "All"}</option>
                {#each Object.entries(typeMap) as [key, value]}
                    <option value={key}>{i18n.lang === "zh" ? value.label : value.labelEn}</option>
                {/each}
            </select>
        </div>

        <button
            onclick={loadTasks}
            class="px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition"
        >
            {i18n.lang === "zh" ? "刷新" : "Refresh"}
        </button>
    </div>

    <!-- Task List -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        {#if isLoading}
            <div class="flex items-center justify-center py-12">
                <Loader2 class="w-6 h-6 animate-spin text-indigo-500" />
            </div>
        {:else if getFilteredTasks().length === 0}
            <div class="flex flex-col items-center justify-center py-12 text-slate-500">
                <ListTodo class="w-12 h-12 mb-3 text-slate-300" />
                <p>{i18n.lang === "zh" ? "暂无任务" : "No tasks found"}</p>
            </div>
        {:else}
            <div class="divide-y divide-slate-100 dark:divide-slate-800">
                {#each getFilteredTasks() as task}
                    {@const statusInfo = getStatusInfo(task.status)}
                    {@const typeInfo = getTypeInfo(task.type)}
                    <div class="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                        <div class="flex items-start justify-between gap-4">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="px-2 py-0.5 text-xs font-medium rounded {statusInfo.color}">
                                        {i18n.lang === "zh" ? statusInfo.label : statusInfo.labelEn}
                                    </span>
                                    <span class="px-2 py-0.5 text-xs font-medium rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                        {i18n.lang === "zh" ? typeInfo.label : typeInfo.labelEn}
                                    </span>
                                    {#if task.priority > 0}
                                        <span class="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400">
                                            P{task.priority}
                                        </span>
                                    {/if}
                                </div>
                                
                                <h3 class="font-medium text-slate-900 dark:text-white truncate">{task.name}</h3>
                                {#if task.description}
                                    <p class="text-sm text-slate-500 mt-1">{task.description}</p>
                                {/if}

                                <!-- Progress Bar -->
                                {#if task.status === 1}
                                    <div class="mt-3">
                                        <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
                                            <span>{task.processed_items} / {task.total_items}</span>
                                            <span>{task.progress}%</span>
                                        </div>
                                        <div class="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                                class="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                                style="width: {task.progress}%"
                                            ></div>
                                        </div>
                                    </div>
                                {/if}

                                <!-- Error Message -->
                                {#if task.status === 3 && task.error_message}
                                    <div class="mt-2 p-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                                        <p class="text-xs text-red-600 dark:text-red-400">{task.error_message}</p>
                                    </div>
                                {/if}

                                <!-- Meta Info -->
                                <div class="flex items-center gap-4 mt-2 text-xs text-slate-400">
                                    <span>
                                        {i18n.lang === "zh" ? "创建于" : "Created"}: {formatTime(task.created_at)}
                                    </span>
                                    {#if task.started_at}
                                        <span>
                                            {i18n.lang === "zh" ? "耗时" : "Duration"}: {formatDuration(task.started_at, task.completed_at)}
                                        </span>
                                    {/if}
                                </div>
                            </div>

                            <!-- Actions -->
                            <div class="flex items-center gap-2">
                                {#if task.status === 1}
                                    <button
                                        onclick={() => cancelTask(task.id)}
                                        class="p-2 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition"
                                        title={i18n.lang === "zh" ? "取消" : "Cancel"}
                                    >
                                        <Pause class="w-4 h-4 text-amber-500" />
                                    </button>
                                {/if}
                                
                                {#if task.status === 3}
                                    <button
                                        onclick={() => retryTask(task.id)}
                                        class="p-2 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition"
                                        title={i18n.lang === "zh" ? "重试" : "Retry"}
                                    >
                                        <RotateCcw class="w-4 h-4 text-blue-500" />
                                    </button>
                                {/if}

                                {#if task.status !== 1}
                                    <button
                                        onclick={() => deleteTask(task.id)}
                                        class="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition"
                                        title={i18n.lang === "zh" ? "删除" : "Delete"}
                                    >
                                        <Trash2 class="w-4 h-4 text-red-500" />
                                    </button>
                                {/if}
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <!-- Stats Summary -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        {#each Object.entries(statusMap) as [key, value]}
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div class="text-2xl font-bold text-slate-900 dark:text-white">
                    {tasks.filter(t => t.status === parseInt(key)).length}
                </div>
                <div class="text-xs text-slate-500">{i18n.lang === "zh" ? value.label : value.labelEn}</div>
            </div>
        {/each}
    </div>
</div>
