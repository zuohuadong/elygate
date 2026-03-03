<script lang="ts">
    import { Settings, Save } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";

    let settings = $state<Record<string, string>>({
        ServerName: "Elygate",
        SignEnabled: "true",
        SignRegisterQuota: "500000",
        DefaultGroup: "default",
        SMTPServer: "",
        SMTPPort: "465",
        SMTPAccount: "",
        SMTPPassword: "",
    });

    let isLoading = $state(true);
    let isSaving = $state(false);
    let errorMsg = $state("");
    let successMsg = $state("");

    async function loadSettings() {
        isLoading = true;
        errorMsg = "";
        try {
            const data =
                await apiFetch<Record<string, string>>("/admin/options");
            settings = { ...settings, ...data }; // Merge with defaults
        } catch (err: any) {
            errorMsg = err.message || "Failed to load settings";
        } finally {
            isLoading = false;
        }
    }

    onMount(loadSettings);

    async function handleSave(e: Event) {
        e.preventDefault();
        isSaving = true;
        errorMsg = "";
        successMsg = "";
        try {
            await apiFetch("/admin/options", {
                method: "PUT",
                body: JSON.stringify(settings),
            });
            successMsg =
                i18n.lang === "zh" ? "保存成功" : "Successfully saved settings";
            setTimeout(() => (successMsg = ""), 3000);
        } catch (err: any) {
            errorMsg = err.message || i18n.t.common.failed;
        } finally {
            isSaving = false;
        }
    }
</script>

<div class="flex-1 space-y-6 text-left max-w-4xl">
    <div>
        <h2
            class="text-2xl font-bold tracking-tight flex items-center gap-2 text-slate-900 dark:text-white"
        >
            <Settings class="w-6 h-6 text-indigo-500" />
            {i18n.t.nav.settings}
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {i18n.lang === "zh"
                ? "配置系统全局参数、注册奖励及邮件等服务"
                : "Configure global system parameters, registration rewards and mail services"}
        </p>
    </div>

    {#if isLoading}
        <div class="flex justify-center items-center py-12">
            <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"
            ></div>
        </div>
    {:else}
        {#if errorMsg}
            <div
                class="p-4 mb-4 text-sm text-rose-800 bg-rose-50 rounded-lg dark:bg-rose-900/10 dark:text-rose-400 border border-rose-100 dark:border-rose-800/50"
            >
                {errorMsg}
            </div>
        {/if}
        {#if successMsg}
            <div
                class="p-4 mb-4 text-sm text-emerald-800 bg-emerald-50 rounded-lg dark:bg-emerald-900/10 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/50"
            >
                {successMsg}
            </div>
        {/if}

        <form class="space-y-6" onsubmit={handleSave}>
            <!-- General Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    General Configuration
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >System Name</label
                        >
                        <input
                            bind:value={settings.ServerName}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <!-- Registration & Quota -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    Registration & Users
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >Enable Registration</label
                        >
                        <select
                            bind:value={settings.SignEnabled}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                        </select>
                    </div>
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >Initial Quota ($0.5 = 500000)</label
                        >
                        <input
                            type="number"
                            bind:value={settings.SignRegisterQuota}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >Default Group</label
                        >
                        <input
                            bind:value={settings.DefaultGroup}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <!-- SMTP Server Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    SMTP Configuration (Optional)
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >SMTP Server</label
                        >
                        <input
                            bind:value={settings.SMTPServer}
                            placeholder="smtp.example.com"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >SMTP Port</label
                        >
                        <input
                            type="number"
                            bind:value={settings.SMTPPort}
                            placeholder="465"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >SMTP Account</label
                        >
                        <input
                            bind:value={settings.SMTPAccount}
                            placeholder="no-reply@example.com"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >SMTP Password</label
                        >
                        <input
                            type="password"
                            bind:value={settings.SMTPPassword}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <div class="flex justify-end pt-4">
                <button
                    type="submit"
                    disabled={isSaving}
                    class="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-lg shadow-indigo-500/30 transition-all"
                >
                    {#if isSaving}
                        <div
                            class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                        ></div>
                    {:else}
                        <Save class="w-4 h-4" />
                    {/if}
                    {i18n.t.common.save}
                </button>
            </div>
        </form>
    {/if}
</div>
