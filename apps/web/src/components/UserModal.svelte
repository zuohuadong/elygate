<script lang="ts">
    import { X, Save } from "lucide-svelte";
    import { fade, scale } from "svelte/transition";
    import { i18n } from "$lib/i18n/index.svelte";
    import { apiFetch } from "$lib/api";

    import { type User } from "$lib/types";

    let {
        show = false,
        user = null,
        onClose = () => {},
        onSave = (data: any) => {},
    } = $props<{
        show: boolean;
        user: User | null;
        onClose: () => void;
        onSave: (data: any) => Promise<void>;
    }>();

    // Form state
    let formData = $state({
        username: "",
        password: "",
        role: 1,
        quota: 0,
        group: "default",
        status: 1,
    });

    let isSubmitting = $state(false);
    let error = $state("");
    let userGroups = $state<any[]>([]);

    $effect(() => {
        if (show) {
            if (userGroups.length === 0) {
                apiFetch<any[]>("/admin/user-groups").then(data => {
                    userGroups = data;
                }).catch(e => console.error("Failed to load user groups:", e));
            }

            if (user) {
                formData = {
                    username: user.username || "",
                    password: "", // Never populate password on edit
                    role: user.role ?? 1,
                    quota: user.quota ?? 0,
                    group: user.group || "default",
                    status: user.status ?? 1,
                };
            } else {
                formData = {
                    username: "",
                    password: "",
                    role: 1,
                    quota: 500000,
                    group: "default",
                    status: 1,
                };
            }
            error = "";
        }
    });

    async function handleSubmit() {
        error = "";
        isSubmitting = true;
        try {
            if (!user && !formData.password) {
                throw new Error(i18n.t.users.passwordRequired);
            }
            const payload = { ...formData };
            if (user && !payload.password) {
                delete (payload as any).password;
            }
            await onSave(payload);
        } catch (err: any) {
            error = err.message || i18n.t.common.failed;
        } finally {
            isSubmitting = false;
        }
    }
</script>

{#if show}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        transition:fade={{ duration: 200 }}
        onclick={onClose}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="bg-white dark:bg-slate-950 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            transition:scale={{ duration: 200, start: 0.95 }}
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50"
            >
                <h3
                    class="text-lg font-semibold text-slate-900 dark:text-white"
                >
                    {user ? i18n.t.common.edit : i18n.t.common.add} {i18n.t.users.title}
                </h3>
                <button
                    onclick={onClose}
                    class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                >
                    <X class="w-5 h-5" />
                </button>
            </div>

            <div
                class="px-6 py-6 max-h-[70vh] overflow-y-auto space-y-4 text-left"
            >
                {#if error}
                    <div
                        class="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-lg border border-rose-100 dark:border-rose-800/50"
                    >
                        {error}
                    </div>
                {/if}

                <div class="space-y-1.5">
                    <label
                        for="u-username"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.users.username}</label
                    >
                    <input
                        id="u-username"
                        bind:value={formData.username}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="space-y-1.5">
                    <label
                        for="u-password"
                        class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >{i18n.t.users.password}</label
                    >
                    <input
                        id="u-password"
                        type="password"
                        placeholder={user
                            ? i18n.t.users.passwordEditPlaceholder
                            : i18n.t.users.passwordPlaceholder}
                        bind:value={formData.password}
                        class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label
                            for="u-role"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.users.role}</label
                        >
                        <select
                            id="u-role"
                            bind:value={formData.role}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value={1}>{i18n.t.users.normalUser}</option>
                            <option value={10}>{i18n.t.users.admin}</option>
                        </select>
                    </div>
                    <div class="space-y-1.5">
                        <label
                            for="u-quota"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.users.quota}</label
                        >
                        <input
                            id="u-quota"
                            type="number"
                            bind:value={formData.quota}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <label
                            for="u-group"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.users.group}</label
                        >
                        <select
                            id="u-group"
                            bind:value={formData.group}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            {#if userGroups.length > 0}
                                {#each userGroups as g}
                                    <option value={g.key}>{g.name} ({g.key})</option>
                                {/each}
                            {:else}
                                <option value={formData.group}>{formData.group}</option>
                            {/if}
                        </select>
                    </div>
                    <div class="space-y-1.5">
                        <label
                            for="u-status"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.users.status}</label
                        >
                        <select
                            id="u-status"
                            bind:value={formData.status}
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value={1}>{i18n.t.users.active}</option>
                            <option value={2}>{i18n.t.users.disabled}</option>
                        </select>
                    </div>
                </div>
            </div>

            <div
                class="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50"
            >
                <button
                    onclick={onClose}
                    class="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                    {i18n.t.common.cancel}
                </button>
                <button
                    onclick={handleSubmit}
                    disabled={isSubmitting}
                    class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
                >
                    {#if isSubmitting}
                        <div
                            class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                        ></div>
                    {:else}
                        <Save class="w-4 h-4" />
                    {/if}
                    {i18n.t.common.save}
                </button>
            </div>
        </div>
    </div>
{/if}
