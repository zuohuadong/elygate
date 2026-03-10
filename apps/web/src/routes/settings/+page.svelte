<script lang="ts">
    import { Settings, Save } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";

    let settings = $state<Record<string, string>>({
        ServerName: "Elygate",
        RegisterMode: "open",
        SignRegisterQuota: "500000",
        DefaultGroup: "default",
        DefaultCurrency: "USD",
        ExchangeRate: "7.2",
        PaymentEnabled: "true",
        PaymentMethods: "redemption",
        PasswordLoginEnabled: "true",
        GitHubOAuthEnabled: "false",
        GitHubClientId: "",
        GitHubClientSecret: "",
        WeChatOAuthEnabled: "false",
        WeChatAppId: "",
        WeChatAppSecret: "",
        SMTPServer: "",
        SMTPPort: "465",
        SMTPAccount: "",
        SMTPPassword: "",
        AlertThresholdWarning: "50",
        AlertThresholdCritical: "80",
        AlertThresholdExhausted: "90",
        EnableHealthCheck: "false",
        CircuitBreakerThreshold: "5",
        CircuitBreakerRecoveryThreshold: "3",
        LogRetentionDays: "7",
        SemanticCacheThreshold: "0.95",
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
            errorMsg =
                err.message ||
                (i18n.lang === "zh"
                    ? "加载设置失败"
                    : "Failed to load settings");
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
            {i18n.t.settings.desc}
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
                    {i18n.t.settings.general}
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            for="server-name"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.settings.systemName}</label
                        >
                        <input
                            id="server-name"
                            bind:value={settings.ServerName}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <!-- Registration Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    {i18n.lang === "zh" ? "注册设置" : "Registration Settings"}
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            for="register-mode"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "注册模式"
                                : "Registration Mode"}</label
                        >
                        <select
                            id="register-mode"
                            bind:value={settings.RegisterMode}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value="open"
                                >{i18n.lang === "zh"
                                    ? "开放注册"
                                    : "Open Registration"}</option
                            >
                            <option value="invite"
                                >{i18n.lang === "zh"
                                    ? "邀请码注册"
                                    : "Invite Only"}</option
                            >
                            <option value="closed"
                                >{i18n.lang === "zh"
                                    ? "关闭注册"
                                    : "Closed"}</option
                            >
                        </select>
                        <p class="text-xs text-slate-500">
                            {#if settings.RegisterMode === "open"}
                                {i18n.lang === "zh"
                                    ? "任何人都可以注册，邀请码可选（可获额外额度）"
                                    : "Anyone can register. Invite code optional for bonus quota."}
                            {:else if settings.RegisterMode === "invite"}
                                {i18n.lang === "zh"
                                    ? "必须使用有效邀请码才能注册"
                                    : "Valid invite code required for registration."}
                            {:else}
                                {i18n.lang === "zh"
                                    ? "禁止所有新用户注册"
                                    : "New user registration is disabled."}
                            {/if}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="sign-quota"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "初始额度 ($)"
                                : "Initial Quota ($)"}</label
                        >
                        <input
                            id="sign-quota"
                            type="number"
                            bind:value={settings.SignRegisterQuota}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "新用户注册获得的初始额度（1美元 = 1000配额）"
                                : "Initial quota for new users ($1 = 1000 quota)"}
                        </p>
                    </div>
                </div>
                {#if settings.RegisterMode === "invite"}
                    <div
                        class="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800"
                    >
                        <a
                            href="/invite-codes"
                            class="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            {i18n.lang === "zh"
                                ? "管理邀请码 →"
                                : "Manage Invite Codes →"}
                        </a>
                    </div>
                {/if}
            </div>

            <!-- Currency Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    {i18n.lang === "zh"
                        ? "货币与汇率设置"
                        : "Currency & Exchange Rate"}
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="space-y-2">
                        <label
                            for="default-currency"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "新用户默认货币"
                                : "Default Currency for New Users"}</label
                        >
                        <select
                            id="default-currency"
                            bind:value={settings.DefaultCurrency}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value="USD">USD ($)</option>
                            <option value="RMB">RMB (¥)</option>
                        </select>
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "新注册用户的默认显示货币"
                                : "Default display currency for new users"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="exchange-rate"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "汇率 (1 USD = ? RMB)"
                                : "Exchange Rate (1 USD = ? RMB)"}</label
                        >
                        <input
                            id="exchange-rate"
                            type="number"
                            step="0.01"
                            bind:value={settings.ExchangeRate}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "用于货币换算，仅影响显示，不影响实际额度"
                                : "For display conversion only, does not affect actual quota"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                            {i18n.lang === "zh"
                                ? "换算参考"
                                : "Conversion Reference"}
                        </label>
                        <div
                            class="px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm"
                        >
                            <p class="text-slate-600 dark:text-slate-400">
                                $1 = ¥{parseFloat(
                                    settings.ExchangeRate || "7.2",
                                ).toFixed(2)}
                            </p>
                            <p
                                class="text-slate-500 dark:text-slate-500 text-xs mt-1"
                            >
                                1,000 quota = ${(1000 / 500000).toFixed(4)} = ¥{(
                                    (1000 / 500000) *
                                    parseFloat(settings.ExchangeRate || "7.2")
                                ).toFixed(4)}
                            </p>
                        </div>
                    </div>
                </div>
                <div
                    class="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg"
                >
                    <p class="text-xs text-amber-700 dark:text-amber-400">
                        <strong
                            >{i18n.lang === "zh" ? "注意：" : "Note:"}</strong
                        >
                        {i18n.lang === "zh"
                            ? "修改汇率仅影响前端显示，不会改变用户实际存储的额度。系统内部统一使用 quota 单位计费。"
                            : "Changing exchange rate only affects display, not actual stored quota. System uses quota units internally."}
                    </p>
                </div>
            </div>

            <!-- Payment Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    {i18n.lang === "zh" ? "充值设置" : "Payment Settings"}
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            for="payment-enabled"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "开启充值功能"
                                : "Enable Payment"}</label
                        >
                        <select
                            id="payment-enabled"
                            bind:value={settings.PaymentEnabled}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value="true"
                                >{i18n.t.settings.enabled}</option
                            >
                            <option value="false"
                                >{i18n.t.settings.disabled}</option
                            >
                        </select>
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "关闭后用户将无法使用充值码充值"
                                : "Disable to prevent users from redeeming codes"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="payment-methods"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "充值方式"
                                : "Payment Methods"}</label
                        >
                        <select
                            id="payment-methods"
                            bind:value={settings.PaymentMethods}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value="redemption"
                                >{i18n.lang === "zh"
                                    ? "兑换码充值"
                                    : "Redemption Code"}</option
                            >
                            <option value="online"
                                >{i18n.lang === "zh"
                                    ? "在线支付"
                                    : "Online Payment"}</option
                            >
                            <option value="both"
                                >{i18n.lang === "zh"
                                    ? "兑换码 + 在线支付"
                                    : "Both"}</option
                            >
                        </select>
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "选择用户可用的充值方式"
                                : "Select available payment methods"}
                        </p>
                    </div>
                </div>
                {#if settings.PaymentEnabled === "true"}
                    <div
                        class="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800"
                    >
                        <a
                            href="/redemptions"
                            class="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            {i18n.lang === "zh"
                                ? "管理兑换码 →"
                                : "Manage Redemption Codes →"}
                        </a>
                    </div>
                {/if}
            </div>

            <!-- Login Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    {i18n.lang === "zh" ? "登录设置" : "Login Settings"}
                </h3>
                <div class="space-y-6">
                    <div
                        class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl"
                    >
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center"
                            >
                                <svg
                                    class="w-5 h-5 text-indigo-600 dark:text-indigo-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                                    ></path>
                                </svg>
                            </div>
                            <div>
                                <p
                                    class="font-medium text-slate-900 dark:text-white"
                                >
                                    {i18n.lang === "zh"
                                        ? "密码登录"
                                        : "Password Login"}
                                </p>
                                <p class="text-xs text-slate-500">
                                    {i18n.lang === "zh"
                                        ? "使用用户名和密码登录"
                                        : "Login with username and password"}
                                </p>
                            </div>
                        </div>
                        <select
                            bind:value={settings.PasswordLoginEnabled}
                            class="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        >
                            <option value="true"
                                >{i18n.t.settings.enabled}</option
                            >
                            <option value="false"
                                >{i18n.t.settings.disabled}</option
                            >
                        </select>
                    </div>

                    <div
                        class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl"
                    >
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 bg-slate-800 dark:bg-slate-700 rounded-lg flex items-center justify-center"
                            >
                                <svg
                                    class="w-5 h-5 text-white"
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                                    />
                                </svg>
                            </div>
                            <div class="flex-1">
                                <p
                                    class="font-medium text-slate-900 dark:text-white"
                                >
                                    {i18n.lang === "zh"
                                        ? "GitHub 登录"
                                        : "GitHub Login"}
                                </p>
                                <p class="text-xs text-slate-500">
                                    {i18n.lang === "zh"
                                        ? "使用 GitHub OAuth 登录"
                                        : "Login with GitHub OAuth"}
                                </p>
                            </div>
                        </div>
                        <select
                            bind:value={settings.GitHubOAuthEnabled}
                            class="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        >
                            <option value="true"
                                >{i18n.t.settings.enabled}</option
                            >
                            <option value="false"
                                >{i18n.t.settings.disabled}</option
                            >
                        </select>
                    </div>
                    {#if settings.GitHubOAuthEnabled === "true"}
                        <div
                            class="grid grid-cols-1 md:grid-cols-2 gap-4 pl-14"
                        >
                            <div class="space-y-1">
                                <label
                                    for="github-client-id"
                                    class="text-xs font-medium text-slate-600 dark:text-slate-400"
                                    >GitHub Client ID</label
                                >
                                <input
                                    id="github-client-id"
                                    bind:value={settings.GitHubClientId}
                                    placeholder="Iv1.xxxxxxxx"
                                    class="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                            <div class="space-y-1">
                                <label
                                    for="github-client-secret"
                                    class="text-xs font-medium text-slate-600 dark:text-slate-400"
                                    >GitHub Client Secret</label
                                >
                                <input
                                    id="github-client-secret"
                                    type="password"
                                    bind:value={settings.GitHubClientSecret}
                                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                    class="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                        </div>
                    {/if}

                    <div
                        class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl"
                    >
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center"
                            >
                                <svg
                                    class="w-5 h-5 text-white"
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.406-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.969-.982z"
                                    />
                                </svg>
                            </div>
                            <div class="flex-1">
                                <p
                                    class="font-medium text-slate-900 dark:text-white"
                                >
                                    {i18n.lang === "zh"
                                        ? "微信登录"
                                        : "WeChat Login"}
                                </p>
                                <p class="text-xs text-slate-500">
                                    {i18n.lang === "zh"
                                        ? "使用微信 OAuth 登录"
                                        : "Login with WeChat OAuth"}
                                </p>
                            </div>
                        </div>
                        <select
                            bind:value={settings.WeChatOAuthEnabled}
                            class="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        >
                            <option value="true"
                                >{i18n.t.settings.enabled}</option
                            >
                            <option value="false"
                                >{i18n.t.settings.disabled}</option
                            >
                        </select>
                    </div>
                    {#if settings.WeChatOAuthEnabled === "true"}
                        <div
                            class="grid grid-cols-1 md:grid-cols-2 gap-4 pl-14"
                        >
                            <div class="space-y-1">
                                <label
                                    for="wechat-app-id"
                                    class="text-xs font-medium text-slate-600 dark:text-slate-400"
                                    >{i18n.lang === "zh"
                                        ? "微信 AppID"
                                        : "WeChat App ID"}</label
                                >
                                <input
                                    id="wechat-app-id"
                                    bind:value={settings.WeChatAppId}
                                    placeholder="wxxxxxxxxxxx"
                                    class="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                            <div class="space-y-1">
                                <label
                                    for="wechat-app-secret"
                                    class="text-xs font-medium text-slate-600 dark:text-slate-400"
                                    >{i18n.lang === "zh"
                                        ? "微信 AppSecret"
                                        : "WeChat App Secret"}</label
                                >
                                <input
                                    id="wechat-app-secret"
                                    type="password"
                                    bind:value={settings.WeChatAppSecret}
                                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                                    class="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                        </div>
                    {/if}
                </div>
                <div
                    class="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg"
                >
                    <p class="text-xs text-blue-700 dark:text-blue-400">
                        <strong>{i18n.lang === "zh" ? "提示：" : "Tip:"}</strong
                        >
                        {i18n.lang === "zh"
                            ? "至少需要开启一种登录方式，否则用户将无法登录。"
                            : "At least one login method must be enabled."}
                    </p>
                </div>
            </div>

            <!-- SMTP Server Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    {i18n.t.settings.smtp}
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            for="smtp-server"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.settings.smtpServer}</label
                        >
                        <input
                            id="smtp-server"
                            bind:value={settings.SMTPServer}
                            placeholder="smtp.example.com"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-2">
                        <label
                            for="smtp-port"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.settings.smtpPort}</label
                        >
                        <input
                            id="smtp-port"
                            type="number"
                            bind:value={settings.SMTPPort}
                            placeholder="465"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-2">
                        <label
                            for="smtp-account"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.settings.smtpAccount}</label
                        >
                        <input
                            id="smtp-account"
                            bind:value={settings.SMTPAccount}
                            placeholder="no-reply@example.com"
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div class="space-y-2">
                        <label
                            for="smtp-password"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.t.settings.smtpPassword}</label
                        >
                        <input
                            id="smtp-password"
                            type="password"
                            bind:value={settings.SMTPPassword}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <!-- Alert Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    {i18n.lang === "zh" ? "告警设置" : "Alert Settings"}
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="space-y-2">
                        <label
                            for="alert-warning"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "警告阈值 (%)"
                                : "Warning Threshold (%)"}</label
                        >
                        <input
                            id="alert-warning"
                            type="number"
                            min="0"
                            max="100"
                            bind:value={settings.AlertThresholdWarning}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "预算使用达到此比例时发送警告"
                                : "Send warning when budget reaches this %"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="alert-critical"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "严重阈值 (%)"
                                : "Critical Threshold (%)"}</label
                        >
                        <input
                            id="alert-critical"
                            type="number"
                            min="0"
                            max="100"
                            bind:value={settings.AlertThresholdCritical}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "预算使用达到此比例时发送严重警告"
                                : "Send critical alert at this %"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="alert-exhausted"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "耗尽阈值 (%)"
                                : "Exhausted Threshold (%)"}</label
                        >
                        <input
                            id="alert-exhausted"
                            type="number"
                            min="0"
                            max="100"
                            bind:value={settings.AlertThresholdExhausted}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "预算使用达到此比例时发送耗尽警告"
                                : "Send exhausted alert at this %"}
                        </p>
                    </div>
                </div>
            </div>

            <!-- System Monitoring Settings -->
            <div
                class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm"
            >
                <h3
                    class="text-base font-semibold text-slate-900 dark:text-white mb-4"
                >
                    {i18n.lang === "zh" ? "系统监控" : "System Monitoring"}
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            for="health-check"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "启用健康检查"
                                : "Enable Health Check"}</label
                        >
                        <select
                            id="health-check"
                            bind:value={settings.EnableHealthCheck}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        >
                            <option value="true"
                                >{i18n.t.settings.enabled}</option
                            >
                            <option value="false"
                                >{i18n.t.settings.disabled}</option
                            >
                        </select>
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "定期检查渠道可用性"
                                : "Periodically check channel availability"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="cache-threshold"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "缓存相似度阈值"
                                : "Cache Similarity Threshold"}</label
                        >
                        <input
                            id="cache-threshold"
                            type="number"
                            min="0.5"
                            max="1.0"
                            step="0.01"
                            bind:value={settings.SemanticCacheThreshold}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "语义缓存的余弦相似度匹配阈值 (0.0-1.0，默认 0.95)"
                                : "Cosine similarity threshold for cache (0.0-1.0, default 0.95)"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="log-retention"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "日志保留天数"
                                : "Log Retention Days"}</label
                        >
                        <input
                            id="log-retention"
                            type="number"
                            min="1"
                            max="365"
                            bind:value={settings.LogRetentionDays}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "超过此天数的日志将被自动删除"
                                : "Logs older than this will be deleted"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="circuit-breaker"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "熔断阈值"
                                : "Circuit Breaker Threshold"}</label
                        >
                        <input
                            id="circuit-breaker"
                            type="number"
                            min="1"
                            max="100"
                            bind:value={settings.CircuitBreakerThreshold}
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "连续失败次数达到此值时禁用渠道"
                                : "Disable channel after this many failures"}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <label
                            for="circuit-recovery"
                            class="text-sm font-medium text-slate-700 dark:text-slate-300"
                            >{i18n.lang === "zh"
                                ? "熔断恢复阈值"
                                : "Recovery Threshold"}</label
                        >
                        <input
                            id="circuit-recovery"
                            type="number"
                            min="1"
                            max="100"
                            bind:value={
                                settings.CircuitBreakerRecoveryThreshold
                            }
                            class="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <p class="text-xs text-slate-500">
                            {i18n.lang === "zh"
                                ? "连续成功次数达到此值时恢复渠道"
                                : "Re-enable channel after this many successes"}
                        </p>
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
