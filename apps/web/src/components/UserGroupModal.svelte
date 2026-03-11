<script lang="ts">
    import { X } from "lucide-svelte";
    import { fade, fly } from "svelte/transition";
    import { i18n } from "$lib/i18n/index.svelte";

    let { show, group, onClose, onSave } = $props<{
        show: boolean;
        group: any | null;
        onClose: () => void;
        onSave: (data: any) => void;
    }>();

    let formData = $state({
        key: "",
        name: "",
        description: "",
        allowedChannelTypes: "",
        deniedChannelTypes: "",
        allowedModels: "",
        deniedModels: "",
        allowedPackages: "",
        status: 1
    });

    $effect(() => {
        if (show) {
            if (group) {
                formData = {
                    key: group.key,
                    name: group.name,
                    description: group.description || "",
                    allowedChannelTypes: Array.isArray(group.allowed_channel_types) ? group.allowed_channel_types.join(",") : "",
                    deniedChannelTypes: Array.isArray(group.denied_channel_types) ? group.denied_channel_types.join(",") : "",
                    allowedModels: Array.isArray(group.allowed_models) ? group.allowed_models.join("\n") : "",
                    deniedModels: Array.isArray(group.denied_models) ? group.denied_models.join("\n") : "",
                    allowedPackages: Array.isArray(group.allowed_packages) ? group.allowed_packages.join(",") : "",
                    status: group.status || 1
                };
            } else {
                formData = {
                    key: "",
                    name: "",
                    description: "",
                    allowedChannelTypes: "",
                    deniedChannelTypes: "",
                    allowedModels: "",
                    deniedModels: "",
                    allowedPackages: "",
                    status: 1
                };
            }
        }
    });

    const isInternalGroup = $derived(group?.key === 'default' || group?.key === 'cn-safe');

    function handleSubmit(e: Event) {
        e.preventDefault();
        
        const parseNumArray = (str: string) => str.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        const parseStrArray = (str: string) => str.split(/[\n,]/).map(s => s.trim()).filter(Boolean);

        const data = {
            ...formData,
            allowedChannelTypes: parseNumArray(formData.allowedChannelTypes),
            deniedChannelTypes: parseNumArray(formData.deniedChannelTypes),
            allowedModels: parseStrArray(formData.allowedModels),
            deniedModels: parseStrArray(formData.deniedModels),
            allowedPackages: parseNumArray(formData.allowedPackages),
        };
        onSave(data);
    }
</script>

{#if show}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0 bg-slate-900/50 backdrop-blur-sm"
        transition:fade={{ duration: 200 }}
        onclick={(e) => e.target === e.currentTarget && onClose()}
    >
        <div
            class="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]"
            transition:fly={{ y: 20, duration: 300, opacity: 0 }}
            onclick={(e) => e.stopPropagation()}
        >
            <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
                <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                    {group ? (i18n.lang === 'zh' ? '编辑用户组' : 'Edit Group') : (i18n.lang === 'zh' ? '新建用户组' : 'New Group')}
                </h3>
                <button
                    onclick={onClose}
                    class="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
                >
                    <X class="w-5 h-5" />
                </button>
            </div>

            <div class="p-6 overflow-y-auto">
                <form id="group-form" onsubmit={handleSubmit} class="space-y-6">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div class="space-y-1.5">
                            <label for="key" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                {i18n.lang === "zh" ? "唯一标识 (Key) *" : "Group Key *"}
                            </label>
                            <input
                                id="key"
                                type="text"
                                bind:value={formData.key}
                                disabled={!!group}
                                required
                                placeholder="e.g. vip-group"
                                class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-900"
                            />
                        </div>
                        <div class="space-y-1.5">
                            <label for="name" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                {i18n.lang === "zh" ? "显示名称 *" : "Display Name *"}
                            </label>
                            <input
                                id="name"
                                type="text"
                                bind:value={formData.name}
                                required
                                class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"
                            />
                        </div>
                    </div>

                    <div class="space-y-1.5">
                        <label for="description" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            {i18n.lang === "zh" ? "描述" : "Description"}
                        </label>
                        <input
                            id="description"
                            type="text"
                            bind:value={formData.description}
                            class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"
                        />
                    </div>

                    <div class="border-t border-slate-200 dark:border-slate-800 pt-6">
                        <h4 class="text-sm font-semibold text-slate-900 dark:text-white mb-4">
                            {i18n.lang === 'zh' ? '维度 1: 渠道商 (Channel Types) 过滤' : 'Dimension 1: Channel Provider Filter'}
                        </h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div class="space-y-1.5">
                                <label for="deniedChannelTypes" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                    {i18n.lang === "zh" ? "黑名单 (禁用类型)" : "Denied Types (Blacklist)"}
                                </label>
                                <input
                                    id="deniedChannelTypes"
                                    type="text"
                                    bind:value={formData.deniedChannelTypes}
                                    placeholder="e.g. 1, 14, 23 (用逗号分隔)"
                                    class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"
                                />
                                <p class="text-xs text-slate-500">
                                    {i18n.lang === 'zh' ? '绝杀对应公司所有模型，如填 1 则禁用所有 OpenAI。' : 'Blocks entire companies (e.g. 1=OpenAI, 14=Anthropic).'}
                                </p>
                            </div>
                            <div class="space-y-1.5">
                                <label for="allowedChannelTypes" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                    {i18n.lang === "zh" ? "白名单 (仅限类型)" : "Allowed Types (Whitelist)"}
                                </label>
                                <input
                                    id="allowedChannelTypes"
                                    type="text"
                                    bind:value={formData.allowedChannelTypes}
                                    placeholder="留空代表不限制"
                                    class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"
                                />
                            </div>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 dark:border-slate-800 pt-6">
                        <h4 class="text-sm font-semibold text-slate-900 dark:text-white mb-4">
                            {i18n.lang === 'zh' ? '维度 2: 模型名称 (Model Name) 过滤' : 'Dimension 2: Model Name Filter'}
                        </h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div class="space-y-1.5">
                                <label for="deniedModels" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                    {i18n.lang === "zh" ? "拦截通配符 (一行一个)" : "Denied Models (Wildcard)"}
                                </label>
                                <textarea
                                    id="deniedModels"
                                    bind:value={formData.deniedModels}
                                    rows="3"
                                    placeholder="sora-*\ngpt-4-*\nmidjourney*"
                                    class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100 font-mono"
                                ></textarea>
                            </div>
                            <div class="space-y-1.5">
                                <label for="allowedModels" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                    {i18n.lang === "zh" ? "豁免通配符 (优先放行)" : "Allowed Models (Exemption)"}
                                </label>
                                <textarea
                                    id="allowedModels"
                                    bind:value={formData.allowedModels}
                                    rows="3"
                                    placeholder="用于在黑名单中特赦某个模型"
                                    class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100 font-mono"
                                ></textarea>
                            </div>
                        </div>
                    </div>

                     <div class="border-t border-slate-200 dark:border-slate-800 pt-6">
                        <div class="space-y-1.5">
                            <label for="allowedPackages" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                {i18n.lang === "zh" ? "可见套餐流 (Package Isolation)" : "Allowed Packages"}
                            </label>
                            <input
                                id="allowedPackages"
                                type="text"
                                bind:value={formData.allowedPackages}
                                placeholder="e.g. 1, 3, 5 (留空则可见所有公开套餐)"
                                class="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900 dark:text-slate-100"
                            />
                        </div>
                    </div>

                    <div class="pt-2">
                        <label class="relative flex items-center cursor-pointer">
                            <input type="checkbox" class="sr-only peer" checked={formData.status === 1} onchange={(e) => formData.status = e.currentTarget.checked ? 1 : 2}>
                            <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 dark:peer-focus:ring-indigo-600 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                            <span class="ms-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                                {i18n.lang === "zh" ? "启用该组" : "Enable Group"}
                            </span>
                        </label>
                    </div>
                </form>
            </div>

            <div class="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end gap-3 shrink-0">
                <button
                    type="button"
                    onclick={onClose}
                    class="px-4 py-2 text-sm font-medium tracking-wide text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700 transition-colors shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
                >
                    {i18n.t.common.cancel}
                </button>
                <button
                    type="submit"
                    form="group-form"
                    class="px-4 py-2 text-sm font-medium tracking-wide text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {i18n.t.common.save}
                </button>
            </div>
        </div>
    </div>
{/if}
