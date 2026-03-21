<script lang="ts">
    import DataTable from "../../components/DataTable.svelte";
    import UserModal from "../../components/UserModal.svelte";
    import GrantPackageModal from "../../components/GrantPackageModal.svelte";
    import { Plus, Users } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    

    import { session } from "$lib/session.svelte";

    let users = $state<any[]>([]);
    let isLoading = $state(true);
    let errorMsg = $state("");

    let isModalOpen = $state(false);
    let selectedUser = $state<any | null>(null);
    let isGrantModalOpen = $state(false);
    let grantSelectedUser = $state<any | null>(null);

    async function loadUsers() {
        isLoading = true;
        try {
            const data = await apiFetch<any[]>("/admin/users");
            users = data.map((u) => ({
                ...u,
                displayRole: u.role >= 10 ? "Admin" : "Normal User",
                displayStatus:
                    u.status === 1
                        ? i18n.t.users.active
                        : i18n.t.users.disabled,
                formattedQuota:
                    u.quota < 0
                        ? i18n.t.tokens.unlimited
                        : `$ ${(Number(u.quota || 0) / session.quotaPerUnit).toFixed(2)}`,
                formattedUsed: `$ ${(Number(u.usedQuota || 0) / session.quotaPerUnit).toFixed(2)}`,
            }));
        } catch (err: unknown) {
            errorMsg = err instanceof Error ? err instanceof Error ? err.message : String(err) : (i18n.lang === "zh" ? "加载用户失败" : "Failed to load users");
        } finally {
            isLoading = false;
        }
    }

    $effect(() => { loadUsers(); });

    const renderStatus = (val: string) => {
        const isActive = val === i18n.t.channels.active;
        const colorClass = isActive
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
            : "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-400";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}">${val}</span>`;
    };

    let columns = $derived([
        { key: "id", label: i18n.t.users.id },
        { key: "username", label: i18n.t.users.username },
        { key: "displayRole", label: i18n.t.users.role },
        { key: "group", label: i18n.t.users.group },
        { key: "formattedQuota", label: i18n.t.tokens.quota },
        { key: "formattedUsed", label: i18n.t.tokens.used },
        {
            key: "displayStatus",
            label: i18n.t.tokens.status,
            render: renderStatus,
        },
    ]);

    function handleAdd() {
        selectedUser = null;
        isModalOpen = true;
    }

    function handleEdit(user: Record<string, any>) {
        selectedUser = user;
        isModalOpen = true;
    }

    function handleGrantPackage(user: Record<string, any>) {
        grantSelectedUser = user;
        isGrantModalOpen = true;
    }

    async function handleDelete(user: Record<string, any>) {
        if (
            !confirm(`Are you sure you want to delete user "${user.username}"?`)
        )
            return;
        try {
            await apiFetch(`/admin/users/${user.id}`, { method: "DELETE" });
            await loadUsers();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }

    async function handleSave(data: Record<string, any>) {
        try {
            if (selectedUser) {
                await apiFetch(`/admin/users/${selectedUser.id}`, {
                    method: "PUT",
                    body: JSON.stringify(data),
                });
            } else {
                await apiFetch("/admin/users", {
                    method: "POST",
                    body: JSON.stringify(data),
                });
            }
            isModalOpen = false;
            await loadUsers();
        } catch (err: unknown) {
            alert(i18n.t.common.failed + ": " + (err instanceof Error ? err.message : String(err)));
        }
    }
</script>

<div class="flex-1 space-y-6 text-left w-full">
    <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
    >
        <div>
            <h2
                class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white"
            >
                <Users class="w-6 h-6 text-indigo-500" />
                {i18n.t.nav.users}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh"
                    ? "管理平台注册用户，分配额度与用户组"
                    : "Manage registered users, assign quotas and groups"}
            </p>
        </div>
        <div class="flex gap-3">
            <button
                onclick={loadUsers}
                class="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
                {i18n.lang === "zh" ? "刷新列表" : "Refresh"}
            </button>
            <button
                onclick={handleAdd}
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                <Plus class="w-4 h-4" />
                {i18n.t.common.add} User
            </button>
        </div>
    </div>

    {#if isLoading}
        <div class="flex justify-center items-center py-12">
            <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"
            ></div>
        </div>
    {:else if errorMsg}
        <div
            class="p-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400"
        >
            {i18n.t.common.failed}: {errorMsg}
        </div>
    {:else}
        <DataTable
            data={users}
            {columns}
            onEdit={handleEdit}
            onDelete={handleDelete}
            extraActions={[
                {
                    label: i18n.lang === "zh" ? "派发套餐" : "Grant",
                    class: "text-emerald-600 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300",
                    onClick: handleGrantPackage
                }
            ]}
        />
    {/if}
</div>

<UserModal
    show={isModalOpen}
    user={selectedUser}
    onClose={() => (isModalOpen = false)}
    onSave={handleSave}
/>

<GrantPackageModal
    show={isGrantModalOpen}
    user={grantSelectedUser}
    onClose={() => (isGrantModalOpen = false)}
    onSave={() => { isGrantModalOpen = false; loadUsers(); }}
/>
