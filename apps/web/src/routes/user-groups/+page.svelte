<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import UserGroupModal from "../../components/UserGroupModal.svelte";
    import { Plus, Users, ShieldAlert } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";

    let groups = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    let isModalOpen = $state(false);
    let selectedGroup = $state<any | null>(null);

    async function loadGroups() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/admin/user-groups");
            groups = data.map(g => ({
                ...g,
                displayModels: g.denied_models?.length > 0 ? (i18n.lang === 'zh' ? '有拦截规则' : 'Has Blocks') : (i18n.lang === 'zh' ? '全放行' : 'All Allowed'),
                displayChannels: g.denied_channel_types?.length > 0 ? (i18n.lang === 'zh' ? '有过滤商' : 'Filtered') : (i18n.lang === 'zh' ? '全放行' : 'All Providers'),
                displayStatus: g.status === 1 ? (i18n.lang === 'zh' ? '正常' : 'Active') : (i18n.lang === 'zh' ? '禁用' : 'Disabled')
            }));
        } catch (err: any) {
            errorMsg = err.message || "Failed to load user groups";
        } finally {
            isLoading = false;
        }
    }

    onMount(loadGroups);

    const renderStatus = (val: string) => {
        const isActive = val === 'Active' || val === '正常';
        const colorClass = isActive
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
            : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}">${val}</span>`;
    };

    const renderThreat = (val: string) => {
        const hasThreat = val.includes('拦截') || val.includes('Blocks') || val.includes('过滤') || val.includes('Filtered');
        const colorClass = hasThreat
            ? "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400"
            : "text-slate-500";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}">${val}</span>`;
    };

    let columns = $derived([
        { key: "key", label: i18n.lang === "zh" ? "标识(Key)" : "Group Key" },
        { key: "name", label: i18n.lang === "zh" ? "名称" : "Name" },
        { key: "displayChannels", label: i18n.lang === "zh" ? "渠道控制" : "Channel Rules", render: renderThreat },
        { key: "displayModels", label: i18n.lang === "zh" ? "模型控制" : "Model Rules", render: renderThreat },
        { key: "displayStatus", label: i18n.lang === "zh" ? "状态" : "Status", render: renderStatus }
    ]);

    function handleAdd() {
        selectedGroup = null;
        isModalOpen = true;
    }

    function handleEdit(group: any) {
        selectedGroup = group;
        isModalOpen = true;
    }

    async function handleDelete(group: any) {
        if (group.key === 'default' || group.key === 'cn-safe') {
            alert(i18n.lang === "zh" ? "系统内置组无法删除！" : "Cannot delete system default groups!");
            return;
        }
        if (!confirm(i18n.lang === "zh" ? `确认删除用户组 "${group.name}" 吗？如果有用户还在该组内将无法删除。` : `Delete group "${group.name}"?`)) return;
        try {
            await apiFetch(`/admin/user-groups/${group.key}`, {
                method: "DELETE",
            });
            await loadGroups();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }

    async function handleSave(data: any) {
        try {
            if (selectedGroup) {
                await apiFetch(`/admin/user-groups/${selectedGroup.key}`, {
                    method: "PUT",
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch("/admin/user-groups", {
                    method: "POST",
                    body: JSON.stringify(data),
                });
            }
            isModalOpen = false;
            await loadGroups();
        } catch (err: any) {
            alert(i18n.t.common.failed + ": " + err.message);
        }
    }

    async function applyChinaCompliance(group: any) {
        if (!confirm(i18n.lang === "zh" ? `是否一键将 "${group.name}" 设为符合中国境内合规要求的策略组（如禁用境外被禁厂商）？` : `Apply China Compliance blocks to "${group.name}"?`)) return;
        try {
            const rules = {
                // OpenAI(1), Anthropic(14), Google(23,24), xAI(33), Meta etc.
                deniedChannelTypes: [1, 2, 8, 14, 23, 24, 33],
                deniedModels: ["gpt-*", "claude-*", "gemini-*", "sora-*", "dall-e-*"],
            };
            await apiFetch(`/admin/user-groups/${group.key}`, {
                method: "PUT",
                body: JSON.stringify(rules),
            });
            await loadGroups();
        } catch (err: any) {
             alert(i18n.t.common.failed + ": " + err.message);
        }
    }
</script>

<div class="flex-1 space-y-6 text-left max-w-5xl mx-auto w-full">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
            <h2 class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">
                <Users class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "用户组与合规策略" : "User Groups & Policies"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "将用户分配到不同策略组，通过通道类型或通配符精细控制其可使用的模型库，规避法律风险。"
                    : "Assign users to groups and control their model access via provider types or wildcards to ensure compliance."}
            </p>
        </div>
        <div class="flex gap-3">
            <button
                onclick={loadGroups}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.lang === "zh" ? "新建分组" : "New Group"}
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
            data={groups}
            {columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
        >
            {#snippet customActions(group)}
                <button
                    class="text-amber-600 hover:text-amber-800 dark:text-amber-500 dark:hover:text-amber-400 transition-colors mr-2"
                    title={i18n.lang === 'zh' ? '一键中国合规净化' : 'Apply Censorship Rules'}
                    onclick={() => applyChinaCompliance(group)}
                >
                    <ShieldAlert class="w-4 h-4" />
                </button>
            {/snippet}
        </DataTable>
    {/if}
</div>

<UserGroupModal
    show={isModalOpen}
    group={selectedGroup}
    onClose={() => (isModalOpen = false)}
    onSave={handleSave}
/>
