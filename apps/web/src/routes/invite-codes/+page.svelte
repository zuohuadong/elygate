<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import CopyButton from "../../components/CopyButton.svelte";
    import { Plus, Ticket, Trash2 } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { session } from "$lib/session.svelte";
    

    interface InviteCode {
        id: number;
        code: string;
        maxUses: number;
        usedCount: number;
        giftQuota: number;
        status: number;
        expiresAt: string | null;
        creatorName: string | null;
        createdAt: string;
        displayStatus?: string;
        usageStr?: string;
        formattedQuota?: string;
        formattedExpires?: string;
    }

    let inviteCodes = $state<InviteCode[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");
    let total = $state(0);
    let page = $state(1);
    let limit = $state(50);

    let isModalOpen = $state(false);
    let isBatchMode = $state(false);

    let formData = $state({
        count: 1,
        maxUses: 1,
        giftQuota: 0,
        expiresAt: "",
        codePrefix: ""
    });

    async function loadData() {
        isLoading = true;
        try {
            const data = await apiFetch<{ data: InviteCode[], total: number }>(`/admin/invite-codes?page=${page}&limit=${limit}`);
            inviteCodes = data.data.map((c) => {
                const giftQuota = c.giftQuota || 0;
                return {
                    ...c,
                    displayStatus: getStatusText(c.status, c.usedCount, c.maxUses, c.expiresAt),
                    formattedQuota: session.formatQuota(Number(giftQuota)),
                    usageStr: `${c.usedCount || 0} / ${c.maxUses || 0}`,
                    formattedExpires: c.expiresAt ? new Date(c.expiresAt).toLocaleString() : "-"
                };
            });
            total = data.total;
        } catch (err: unknown) {
            errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : (i18n.lang === "zh" ? "加载邀请码失败" : "Failed to load invite codes");
        } finally {
            isLoading = false;
        }
    }

    function getStatusText(status: number, usedCount: number, maxUses: number, expiresAt: string | null): string {
        if (status !== 1) return i18n.lang === "zh" ? "已禁用" : "Disabled";
        if (usedCount >= maxUses) return i18n.lang === "zh" ? "已用完" : "Exhausted";
        if (expiresAt && new Date(expiresAt) < new Date()) return i18n.lang === "zh" ? "已过期" : "Expired";
        return i18n.lang === "zh" ? "有效" : "Active";
    }

    $effect(() => { loadData(); });

    let columns = $derived([
        { key: "id", label: "ID" },
        { key: "code", label: i18n.lang === "zh" ? "邀请码" : "Code" },
        { key: "usageStr", label: i18n.lang === "zh" ? "使用次数" : "Usage" },
        { key: "formattedQuota", label: i18n.lang === "zh" ? "赠送额度" : "Gift Quota" },
        { key: "formattedExpires", label: i18n.lang === "zh" ? "过期时间" : "Expires" },
        { key: "creatorName", label: i18n.lang === "zh" ? "创建者" : "Creator" },
        { key: "displayStatus", label: i18n.t.tokens.status },
    ]);

    function handleAdd() {
        isBatchMode = false;
        formData = { count: 1, maxUses: 1, giftQuota: 0, expiresAt: "", codePrefix: "" };
        isModalOpen = true;
    }

    function handleBatchAdd() {
        isBatchMode = true;
        formData = { count: 10, maxUses: 1, giftQuota: 0, expiresAt: "", codePrefix: "" };
        isModalOpen = true;
    }

    async function handleDelete(item: InviteCode) {
        if (!confirm(i18n.lang === "zh" ? `确定要删除邀请码 "${item.code}" 吗？` : `Are you sure you want to delete invite code "${item.code}"?`)) return;
        try {
            await apiFetch(`/admin/invite-codes/${item.id}`, { method: "DELETE" });
            await loadData();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + err instanceof Error ? err.message : String(err));
        }
    }

    async function handleToggleStatus(item: InviteCode) {
        const newStatus = item.status === 1 ? 2 : 1;
        try {
            await apiFetch(`/admin/invite-codes/${item.id}`, {
                method: "PUT",
                body: JSON.stringify({ status: newStatus })
            });
            await loadData();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + err instanceof Error ? err.message : String(err));
        }
    }

    async function handleSubmit(e: Event) {
        e.preventDefault();
        try {
            const payload: Record<string, unknown> = {
                maxUses: formData.maxUses,
                giftQuota: formData.giftQuota,
            };
            if (isBatchMode) {
                payload.count = formData.count;
                if (formData.codePrefix) payload.codePrefix = formData.codePrefix;
            }
            if (formData.expiresAt) {
                payload.expiresAt = formData.expiresAt;
            }
            await apiFetch("/admin/invite-codes", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            isModalOpen = false;
            await loadData();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + err instanceof Error ? err.message : String(err));
        }
    }
</script>

<div class="flex-1 space-y-6 text-left w-full">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
            <h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">
                <Ticket class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "邀请码管理" : "Invite Codes"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh" ? "管理和生成注册邀请码" : "Manage and generate registration invite codes"}
            </p>
        </div>
        <div class="flex gap-3">
            <button
                onclick={loadData}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                <Plus class="w-4 h-4" />
                {i18n.lang === "zh" ? "生成邀请码" : "Generate"}
            </button>
            <button
                onclick={handleBatchAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.lang === "zh" ? "批量生成" : "Batch Generate"}
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
            data={inviteCodes}
            {columns}
            onDelete={handleDelete}
        >
            {#snippet cell(key, value, row)}
                {#if key === 'code'}
                    <div class="flex items-center gap-2">
                        <code class="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">{value}</code>
                        <CopyButton {value} />
                    </div>
                {:else if key === 'displayStatus'}
                    {@const isActive = value === (i18n.lang === "zh" ? "有效" : "Active")}
                    {@const isAmber = value === (i18n.lang === "zh" ? "已用完" : "Exhausted") || value === (i18n.lang === "zh" ? "已过期" : "Expired")}
                    {@const isRose = value === (i18n.lang === "zh" ? "已禁用" : "Disabled")}
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium 
                        {isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400' : 
                         isAmber ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400' :
                         isRose ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400' :
                         'bg-slate-100 text-slate-800 dark:bg-slate-500/10 dark:text-slate-400'}">
                        {value}
                    </span>
                {:else}
                    {value}
                {/if}
            {/snippet}

            {#snippet customActions(row)}
                <button
                    onclick={() => handleToggleStatus(row)}
                    class="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors mr-2 opacity-0 group-hover:opacity-100"
                >
                    {row.status === 1 ? (i18n.lang === "zh" ? "禁用" : "Disable") : (i18n.lang === "zh" ? "启用" : "Enable")}
                </button>
            {/snippet}
        </DataTable>
    {/if}
</div>

{#if isModalOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div 
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" 
        onclick={() => isModalOpen = false}
        role="dialog"
        aria-modal="true"
        aria-label={isBatchMode ? (i18n.lang === "zh" ? "批量生成邀请码" : "Batch Generate Invite Codes") : (i18n.lang === "zh" ? "生成邀请码" : "Generate Invite Code")}
        tabindex="-1"
    >
        <div class="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md" onclick={(e) => e.stopPropagation()}>
            <div class="p-6 border-b border-slate-200 dark:border-slate-800">
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                    {isBatchMode ? (i18n.lang === "zh" ? "批量生成邀请码" : "Batch Generate Invite Codes") : (i18n.lang === "zh" ? "生成邀请码" : "Generate Invite Code")}
                </h3>
            </div>
            <form onsubmit={handleSubmit} class="p-6 space-y-4">
                {#if isBatchMode}
                    <div class="space-y-2">
                        <label for="count" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {i18n.lang === "zh" ? "生成数量" : "Count"}
                        </label>
                        <input
                            id="count"
                            type="number"
                            bind:value={formData.count}
                            min="1"
                            max="100"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                    <div class="space-y-2">
                        <label for="codePrefix" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {i18n.lang === "zh" ? "邀请码前缀（可选）" : "Code Prefix (Optional)"}
                        </label>
                        <input
                            id="codePrefix"
                            type="text"
                            bind:value={formData.codePrefix}
                            placeholder="e.g., promo2024"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                {/if}
                <div class="space-y-2">
                    <label for="maxUses" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {i18n.lang === "zh" ? "最大使用次数" : "Max Uses"}
                    </label>
                    <input
                        id="maxUses"
                        type="number"
                        bind:value={formData.maxUses}
                        min="1"
                        class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                </div>
                <div class="space-y-2">
                    <label for="giftQuota" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {i18n.lang === "zh" ? "赠送额度（美元）" : "Gift Quota (USD)"}
                    </label>
                    <input
                        id="giftQuota"
                        type="number"
                        bind:value={formData.giftQuota}
                        min="0"
                        step="0.01"
                        class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <p class="text-xs text-slate-500">{i18n.lang === "zh" ? "注册时额外赠送的额度" : "Extra quota given upon registration"}</p>
                </div>
                <div class="space-y-2">
                    <label for="expiresAt" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {i18n.lang === "zh" ? "过期时间（可选）" : "Expires At (Optional)"}
                    </label>
                    <input
                        id="expiresAt"
                        type="datetime-local"
                        bind:value={formData.expiresAt}
                        class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                </div>
                <div class="flex gap-3 pt-4">
                    <button
                        type="button"
                        onclick={() => isModalOpen = false}
                        class="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                        {i18n.t.common.cancel}
                    </button>
                    <button
                        type="submit"
                        class="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors"
                    >
                        {i18n.lang === "zh" ? "生成" : "Generate"}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}
