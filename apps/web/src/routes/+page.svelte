<script lang="ts">
    import {
        Key,
        CreditCard,
        Activity,
        Plus,
        ExternalLink,
        Copy,
        Check,
        Zap,
        Clock,
        TrendingUp,
        AlertCircle,
        Users,
        Layers,
        Cpu,
        BarChart3,
    } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { session } from "$lib/session.svelte";
    import { onMount } from "svelte";

    interface Token {
        id: number;
        name: string;
        key: string;
        status: number;
        remainQuota: number;
        usedQuota: number;
        createdAt: string;
    }

    interface RecentLog {
        id: number;
        modelName: string;
        promptTokens: number;
        completionTokens: number;
        quotaCost: number;
        createdAt: string;
        isSuccess: boolean;
    }

    interface UserInfo {
        quota: number;
        usedQuota: number;
    }

    interface AdminStats {
        totalUsers: number;
        activeChannels: number;
        totalQuota: number;
        usedQuota: number;
        todayQuota: number;
    }

    let tokens = $state<Token[]>([]);
    let recentLogs = $state<RecentLog[]>([]);
    let userInfo = $state<UserInfo>({ quota: 0, usedQuota: 0 });
    let adminStats = $state<AdminStats | null>(null);
    let isLoading = $state(true);
    let copiedId = $state<number | null>(null);

    const isAdmin = $derived(session.role >= 10);

    onMount(async () => {
        if (isAdmin) {
            await Promise.all([loadAdminStats(), loadRecentLogs(), loadTokens()]);
        } else {
            await Promise.all([loadTokens(), loadRecentLogs(), loadUserInfo()]);
        }
        isLoading = false;
    });

    async function loadAdminStats() {
        try {
            const data = await apiFetch<AdminStats>("/admin/dashboard/stats");
            adminStats = data;
        } catch (e) {
            console.error("Failed to load admin stats:", e);
        }
    }

    async function loadUserInfo() {
        try {
            const data = await apiFetch<UserInfo>("/user/info");
            userInfo = data || { quota: 0, usedQuota: 0 };
        } catch (e) {
            console.error("Failed to load user info:", e);
        }
    }

    async function loadTokens() {
        try {
            const data = await apiFetch<Token[]>("/user/tokens");
            tokens = data || [];
        } catch (e) {
            console.error("Failed to load tokens:", e);
        }
    }

    async function loadRecentLogs() {
        try {
            const data = await apiFetch<RecentLog[]>("/user/logs?limit=5");
            recentLogs = data || [];
        } catch (e) {
            console.error("Failed to load logs:", e);
        }
    }

    function copyKey(key: string, id: number) {
        navigator.clipboard.writeText(key);
        copiedId = id;
        setTimeout(() => (copiedId = null), 2000);
    }

    function maskKey(key: string): string {
        if (key.length <= 12) return key;
        return key.substring(0, 8) + "..." + key.substring(key.length - 4);
    }

    function formatTime(dateStr: string): string {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return i18n.lang === "zh" ? "刚刚" : "Just now";
        if (minutes < 60)
            return `${minutes} ${i18n.lang === "zh" ? "分钟前" : "min ago"}`;
        if (hours < 24)
            return `${hours} ${i18n.lang === "zh" ? "小时前" : "h ago"}`;
        return `${days} ${i18n.lang === "zh" ? "天前" : "d ago"}`;
    }
</script>

<div class="flex-1 space-y-6 max-w-[1200px] mx-auto w-full">
    <!-- Welcome Header -->
    <div
        class="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-2xl p-6 text-white shadow-lg"
    >
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold">
                    {i18n.lang === "zh" ? "欢迎回来" : "Welcome Back"} 👋
                </h1>
                <p class="text-white/80 mt-1">
                    {#if isAdmin}
                        {i18n.lang === "zh"
                            ? "系统管理员工作台，实时监控整个网关的运行状态"
                            : "System administrator workspace, real-time monitoring of the entire gateway."}
                    {:else}
                        {i18n.lang === "zh"
                            ? "这是您的工作台，管理您的 API 密钥和查看使用情况"
                            : "Your workspace to manage API keys and track usage"}
                    {/if}
                </p>
            </div>
            <div class="hidden md:block">
                {#if isAdmin}
                    <div class="flex gap-2">
                        <a
                            href="/channels"
                            class="inline-flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition text-sm font-medium"
                        >
                            <Layers class="w-4 h-4" />
                            {i18n.lang === "zh" ? "管理渠道" : "Channels"}
                        </a>
                        <a
                            href="/users"
                            class="inline-flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition text-sm font-medium"
                        >
                            <Users class="w-4 h-4" />
                            {i18n.lang === "zh" ? "管理用户" : "Users"}
                        </a>
                    </div>
                {:else}
                    <a
                        href="/tokens"
                        class="inline-flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition text-sm font-medium"
                    >
                        <Plus class="w-4 h-4" />
                        {i18n.lang === "zh" ? "创建令牌" : "Create Token"}
                    </a>
                {/if}
            </div>
        </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-3">
        {#if isAdmin && adminStats}
            <!-- Total Users (Admin Only) -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {i18n.lang === "zh" ? "系统总用户" : "Total Users"}
                        </h3>
                        <div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                            {adminStats.totalUsers}
                        </div>
                    </div>
                    <div class="w-12 h-12 bg-blue-100 dark:bg-blue-500/20 rounded-xl flex items-center justify-center">
                        <Users class="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                </div>
                <div class="mt-3">
                    <a href="/users" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                        {i18n.lang === "zh" ? "管理所有用户" : "Manage all users"} →
                    </a>
                </div>
            </div>

            <!-- Active Channels (Admin Only) -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {i18n.lang === "zh" ? "在线渠道" : "Active Channels"}
                        </h3>
                        <div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                            {adminStats.activeChannels}
                        </div>
                    </div>
                    <div class="w-12 h-12 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center">
                        <Layers class="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                </div>
                <div class="mt-3">
                    <a href="/channels" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                        {i18n.lang === "zh" ? "查看渠道状态" : "View channel status"} →
                    </a>
                </div>
            </div>

            <!-- System Today Usage (Admin Only) -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {i18n.lang === "zh" ? "全站今日消耗" : "Global Today Usage"}
                        </h3>
                        <div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                            {session.formatQuota(adminStats.todayQuota, 2)}
                        </div>
                    </div>
                    <div class="w-12 h-12 bg-purple-100 dark:bg-purple-500/20 rounded-xl flex items-center justify-center">
                        <Activity class="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                </div>
                <div class="mt-3">
                    <a href="/stats" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                        {i18n.lang === "zh" ? "系统全局统计" : "Global statistics"} →
                    </a>
                </div>
            </div>
        {:else}
            <!-- Balance (Consumer Only) -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {i18n.lang === "zh" ? "账户余额" : "Balance"}
                        </h3>
                        <div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                            {session.formatQuota(userInfo.quota - userInfo.usedQuota, 2)}
                        </div>
                    </div>
                    <div class="w-12 h-12 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center">
                        <CreditCard class="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <a href="/payment" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                        {i18n.lang === "zh" ? "充值" : "Recharge"} →
                    </a>
                </div>
            </div>

            <!-- Active Tokens (Consumer Only) -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {i18n.lang === "zh" ? "活跃令牌" : "Active Tokens"}
                        </h3>
                        <div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                            {tokens.filter((t) => t.status === 1).length}
                        </div>
                    </div>
                    <div class="w-12 h-12 bg-blue-100 dark:bg-blue-500/20 rounded-xl flex items-center justify-center">
                        <Key class="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <a href="/tokens" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                        {i18n.lang === "zh" ? "管理令牌" : "Manage Tokens"} →
                    </a>
                </div>
            </div>

            <!-- Usage Today (Consumer Only) -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {i18n.lang === "zh" ? "今日请求" : "Requests Today"}
                        </h3>
                        <div class="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                            {recentLogs.length > 0 ? recentLogs.length : 0}
                        </div>
                    </div>
                    <div class="w-12 h-12 bg-purple-100 dark:bg-purple-500/20 rounded-xl flex items-center justify-center">
                        <Activity class="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <a href="/stats" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                        {i18n.lang === "zh" ? "查看统计" : "View Stats"} →
                    </a>
                </div>
            </div>
        {/if}
    </div>

    <!-- Quick Actions -->
    <div
        class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-6 backdrop-blur-xl"
    >
        <h2
            class="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2"
        >
            <Zap class="w-5 h-5 text-amber-500" />
            {i18n.lang === "zh" ? "快速操作" : "Quick Actions"}
        </h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {#if isAdmin}
                <a
                    href="/channels"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div class="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center">
                        <Layers class="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                            {i18n.lang === "zh" ? "渠道管理" : "Channels"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "管理上游 API 渠道" : "Manage upstream APIs"}
                        </div>
                    </div>
                </a>

                <a
                    href="/users"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div class="w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <Users class="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                            {i18n.lang === "zh" ? "用户管理" : "Users"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "管理系统用户信息" : "Manage user accounts"}
                        </div>
                    </div>
                </a>

                <a
                    href="/models"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div class="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center">
                        <Cpu class="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                            {i18n.lang === "zh" ? "模型管理" : "Models"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "配置模型与价格" : "Configure models & pricing"}
                        </div>
                    </div>
                </a>

                <a
                    href="/stats"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div class="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-lg flex items-center justify-center">
                        <BarChart3 class="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <div class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                            {i18n.lang === "zh" ? "多维统计" : "Analytics"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "全站运营数据分析" : "System-wide analytics"}
                        </div>
                    </div>
                </a>
            {:else}
                <a
                    href="/tokens"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div
                        class="w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center"
                    >
                        <Key class="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <div
                            class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                        >
                            {i18n.lang === "zh" ? "创建令牌" : "Create Token"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "管理 API 密钥" : "Manage API keys"}
                        </div>
                    </div>
                </a>

                <a
                    href="/consumer/docs"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div
                        class="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg flex items-center justify-center"
                    >
                        <ExternalLink class="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <div
                            class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                        >
                            {i18n.lang === "zh" ? "API 文档" : "API Docs"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "查看使用指南" : "View usage guide"}
                        </div>
                    </div>
                </a>

                <a
                    href="/payment"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div
                        class="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center"
                    >
                        <CreditCard class="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <div
                            class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                        >
                            {i18n.lang === "zh" ? "充值" : "Recharge"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "添加账户余额" : "Add balance"}
                        </div>
                    </div>
                </a>

                <a
                    href="/stats"
                    class="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
                >
                    <div
                        class="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-lg flex items-center justify-center"
                    >
                        <TrendingUp class="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <div
                            class="font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                        >
                            {i18n.lang === "zh" ? "数据统计" : "Statistics"}
                        </div>
                        <div class="text-xs text-slate-500">
                            {i18n.lang === "zh" ? "查看详细分析" : "View detailed analytics"}
                        </div>
                    </div>
                </a>
            {/if}
        </div>
    </div>

    <!-- Recent Activity -->
    <div class="grid gap-6 lg:grid-cols-2">
        <!-- My Tokens (Always helpful to show recent API keys) -->
        <div
            class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-xl overflow-hidden"
        >
            <div
                class="p-4 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between"
            >
                <h2
                    class="font-semibold text-slate-900 dark:text-white flex items-center gap-2"
                >
                    <Key class="w-4 h-4 text-blue-500" />
                    {i18n.lang === "zh" ? "我的令牌" : "My Tokens"}
                </h2>
                <a
                    href="/tokens"
                    class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    {i18n.lang === "zh" ? "查看全部" : "View All"}
                </a>
            </div>
            <div class="divide-y divide-slate-100 dark:divide-slate-800">
                {#if isLoading}
                    <div class="p-8 text-center text-slate-500">
                        {i18n.lang === "zh" ? "加载中..." : "Loading..."}
                    </div>
                {:else if tokens.length === 0}
                    <div class="p-8 text-center">
                        <Key class="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p class="text-slate-500 text-sm">
                            {i18n.lang === "zh"
                                ? "暂无令牌，点击创建"
                                : "No tokens yet. Create one to get started."}
                        </p>
                        <a
                            href="/tokens"
                            class="inline-flex items-center gap-1 mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            <Plus class="w-4 h-4" />
                            {i18n.lang === "zh" ? "创建令牌" : "Create Token"}
                        </a>
                    </div>
                {:else}
                    {#each tokens.slice(0, 3) as token}
                        <div
                            class="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                        >
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center"
                                    >
                                        <Key class="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <div>
                                        <div
                                            class="font-medium text-slate-900 dark:text-white text-sm"
                                        >
                                            {token.name}
                                        </div>
                                        <div
                                            class="text-xs text-slate-500 font-mono"
                                        >
                                            {maskKey(token.key)}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onclick={() => copyKey(token.key, token.id)}
                                    class="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                                    title={i18n.lang === "zh" ? "复制" : "Copy"}
                                >
                                    {#if copiedId === token.id}
                                        <Check class="w-4 h-4 text-emerald-500" />
                                    {:else}
                                        <Copy class="w-4 h-4 text-slate-400" />
                                    {/if}
                                </button>
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>

        <!-- Recent Logs -->
        <div
            class="bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-xl overflow-hidden"
        >
            <div
                class="p-4 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between"
            >
                <h2
                    class="font-semibold text-slate-900 dark:text-white flex items-center gap-2"
                >
                    <Clock class="w-4 h-4 text-purple-500" />
                    {isAdmin ? (i18n.lang === "zh" ? "全系统最近请求" : "System Recent Requests") : (i18n.lang === "zh" ? "最近请求" : "Recent Requests")}
                </h2>
                <a
                    href={isAdmin ? "/logs" : "/logs"}
                    class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    {i18n.lang === "zh" ? "查看全部" : "View All"}
                </a>
            </div>
            <div class="divide-y divide-slate-100 dark:divide-slate-800">
                {#if isLoading}
                    <div class="p-8 text-center text-slate-500">
                        {i18n.lang === "zh" ? "加载中..." : "Loading..."}
                    </div>
                {:else if recentLogs.length === 0}
                    <div class="p-8 text-center">
                        <Activity class="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p class="text-slate-500 text-sm">
                            {i18n.lang === "zh"
                                ? "暂无请求记录"
                                : "No recent requests"}
                        </p>
                    </div>
                {:else}
                    {#each recentLogs as log}
                        <div
                            class="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                        >
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 {log.isSuccess ? 'bg-emerald-100 dark:bg-emerald-500/20' : 'bg-red-100 dark:bg-red-500/20'} rounded-lg flex items-center justify-center"
                                    >
                                        {#if log.isSuccess}
                                            <Check class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                        {:else}
                                            <AlertCircle class="w-4 h-4 text-red-600 dark:text-red-400" />
                                        {/if}
                                    </div>
                                    <div>
                                        <div
                                            class="font-medium text-slate-900 dark:text-white text-sm"
                                        >
                                            {log.modelName}
                                        </div>
                                        <div class="text-xs text-slate-500">
                                            {log.promptTokens + log.completionTokens} tokens
                                            · {formatTime(log.createdAt)}
                                        </div>
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div
                                        class="text-sm font-medium text-slate-900 dark:text-white"
                                    >
                                        {session.formatQuota(log.quotaCost, 4)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    </div>
</div>
