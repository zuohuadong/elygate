<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import PackageModal from "../../components/PackageModal.svelte";
    import { Plus, ShoppingBag } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    


    let packages = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    let isModalOpen = $state(false);
    let selectedPackage = $state<any | null>(null);

    async function loadPackages() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/admin/packages");
            packages = data.map(p => ({
                ...p,
                displayModels: Array.isArray(p.models) ? p.models.join(",") : (p.models || ""),
                displayPrice: `$${Number(p.price).toFixed(2)}`,
                displayDuration: `${p.duration_days} ${i18n.lang === 'zh' ? '天' : 'Days'}`,
                displayPublic: p.is_public ? (i18n.lang === 'zh' ? '公开' : 'Public') : (i18n.lang === 'zh' ? '隐藏' : 'Hidden'),
                displayRateLimit: p.default_rate_limit_name || (i18n.lang === 'zh' ? '无限制' : 'No Limit')
            }));
        } catch (err: unknown) {
            errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : "Failed to load packages";
        } finally {
            isLoading = false;
        }
    }

    $effect(() => { loadPackages(); });

    // Render models as small tags
    const renderModels = (val: string) => {
        if (!val) return `<small class="text-slate-400">None</small>`;
        const arr = val.split(",").slice(0, 2);
        let html = arr
            .map(
                (m) => `<span class="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 font-mono shadow-sm border border-slate-200 dark:border-slate-700">${m.trim()}</span>`,
            ).join("");
        if (val.split(",").length > 2) html += `<span class="text-xs text-slate-400 ml-1">...</span>`;
        return html;
    };

    const renderStatus = (val: string) => {
        const isPublic = val === 'Public' || val === '公开';
        const colorClass = isPublic
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
            : "bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}">${val}</span>`;
    };

    let columns = $derived([
        { key: "id", label: "ID" },
        { key: "name", label: i18n.lang === "zh" ? "套餐名称" : "Package Name" },
        { key: "displayPrice", label: i18n.lang === "zh" ? "价格" : "Price" },
        { key: "displayDuration", label: i18n.lang === "zh" ? "周期" : "Duration" },
        {
            key: "displayModels",
            label: i18n.lang === "zh" ? "涵盖模型" : "Models",
            render: renderModels
        },
        { key: "displayRateLimit", label: i18n.lang === "zh" ? "默认限流" : "Default Rate Limit" },
        {
            key: "displayPublic",
            label: i18n.lang === "zh" ? "状态" : "Status",
            render: renderStatus
        }
    ]);

    function handleAdd() {
        selectedPackage = null;
        isModalOpen = true;
    }

    function handleEdit(pkg: Record<string, any>) {
        selectedPackage = pkg;
        isModalOpen = true;
    }

    async function handleDelete(pkg: Record<string, any>) {
        if (!confirm(i18n.lang === "zh" ? `确认删除套餐方案 "${pkg.name}" 吗？这只是下架套餐，已购买该套餐的用户不会受影响。` : `Delete package "${pkg.name}"?`)) return;
        try {
            await apiFetch(`/admin/packages/${pkg.id}`, {
                method: "DELETE",
            });
            await loadPackages();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }

    async function handleSave(data: Record<string, any>) {
        try {
            if (selectedPackage) {
                await apiFetch(`/admin/packages/${selectedPackage.id}`, {
                    method: "PUT",
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch("/admin/packages", {
                    method: "POST",
                    body: JSON.stringify(data),
                });
            }
            isModalOpen = false;
            await loadPackages();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }
</script>

<div class="flex-1 space-y-6 text-left w-full">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
            <h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">
                <ShoppingBag class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "套餐方案" : "Packages"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "创建、定价与管理面向用户的月度等周期的组合模型授权方案。"
                    : "Create, price, and manage duration-based access plans for users."}
            </p>
        </div>
        <div class="flex gap-3">
            <button
                onclick={loadPackages}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.lang === "zh" ? "新建套餐" : "New Package"}
            </button>
        </div>
    </div>

    {#if isLoading}
        <div class="flex justify-center items-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
    {:else if errorMsg}
        <div class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400">
            {i18n.t.common.failed}: {errorMsg}
        </div>
    {:else}
        <DataTable
            data={packages}
            {columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
        />
    {/if}
</div>

<PackageModal
    show={isModalOpen}
    pkg={selectedPackage}
    onClose={() => (isModalOpen = false)}
    onSave={handleSave}
/>
