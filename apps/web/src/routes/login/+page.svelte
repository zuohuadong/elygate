<script lang="ts">
    import { API_BASE, setToken } from "$lib/api";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { i18n } from "$lib/i18n/index.svelte";

    let username = $state("admin");
    let password = $state("");
    let isLoading = $state(false);
    let error = $state("");

    onMount(() => {
        const existing = localStorage.getItem("admin_token");
        if (existing) goto("/");
    });

    async function handleLogin(e: Event) {
        e.preventDefault();
        if (isLoading) return;
        error = "";
        isLoading = true;
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            let data;
            try {
                data = await res.json();
            } catch (err) {
                throw new Error(i18n.lang === "zh" ? "服务器响应无效" : "Invalid response from server");
            }
            if (!res.ok) throw new Error(data.message || (i18n.lang === "zh" ? "登录失败" : "Login failed"));
            setToken(data.token);
            localStorage.setItem("admin_username", data.username);

            if (data.role !== undefined && data.role !== null) {
                localStorage.setItem("admin_role", data.role.toString());
            } else {
                localStorage.setItem("admin_role", "1");
            }

            if (data.role && data.role < 10) {
                goto("/consumer");
            } else {
                goto("/");
            }
        } catch (e: any) {
            error = e.message;
        } finally {
            isLoading = false;
        }
    }
</script>

<svelte:head>
    <title>Elygate – Admin Login</title>
</svelte:head>

<div
    class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 relative overflow-hidden"
>
    <!-- Ambient glow orbs -->
    <div
        class="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none"
    ></div>
    <div
        class="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/15 rounded-full blur-3xl pointer-events-none"
    ></div>

    <div class="relative z-10 w-full max-w-md px-6">
        <!-- Logo -->
        <div class="flex flex-col items-center mb-10">
            <div
                class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-2xl shadow-indigo-500/30 mb-5"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
            </div>
            <h1 class="text-3xl font-bold text-white tracking-tight">
                Elygate
            </h1>
            <p class="text-slate-400 text-sm mt-1">{i18n.lang === "zh" ? "AI API 网关管理系统" : "AI API Gateway Management"}</p>
        </div>

        <!-- Card -->
        <div
            class="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
            <h2 class="text-lg font-semibold text-white mb-6">
                {i18n.lang === "zh" ? "登录以继续" : "Sign in to continue"}
            </h2>

            <form onsubmit={handleLogin} class="space-y-5">
                <div>
                    <label
                        for="username"
                        class="block text-sm font-medium text-slate-300 mb-1.5"
                        >{i18n.lang === "zh" ? "用户名" : "Username"}</label
                    >
                    <input
                        id="username"
                        type="text"
                        bind:value={username}
                        required
                        autocomplete="username"
                        placeholder="admin"
                        class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                </div>
                <div>
                    <label
                        for="password"
                        class="block text-sm font-medium text-slate-300 mb-1.5"
                        >{i18n.lang === "zh" ? "密码" : "Password"}</label
                    >
                    <input
                        id="password"
                        type="password"
                        bind:value={password}
                        required
                        autocomplete="current-password"
                        placeholder="••••••••"
                        class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                </div>

                {#if error}
                    <div
                        class="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <circle cx="12" cy="12" r="10"></circle><line
                                x1="12"
                                y1="8"
                                x2="12"
                                y2="12"
                            ></line><line x1="12" y1="16" x2="12.01" y2="16"
                            ></line>
                        </svg>
                        {error}
                    </div>
                {/if}

                <button
                    type="submit"
                    disabled={isLoading}
                    class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-xl text-sm transition-all duration-200 shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-transparent"
                >
                    {#if isLoading}
                        <span class="flex items-center justify-center gap-2">
                            <svg
                                class="animate-spin w-4 h-4"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <circle
                                    class="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    stroke-width="4"
                                ></circle>
                                <path
                                    class="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                ></path>
                            </svg>
                            {i18n.lang === "zh" ? "登录中..." : "Signing in…"}
                        </span>
                    {:else}
                        {i18n.lang === "zh" ? "登录" : "Sign in"}
                    {/if}
                </button>
            </form>

            <!-- Third-party login -->
            <div class="mt-6">
                <div class="relative">
                    <div class="absolute inset-0 flex items-center">
                        <div class="w-full border-t border-white/10"></div>
                    </div>
                    <div class="relative flex justify-center text-sm">
                        <span class="px-2 bg-transparent text-slate-400"
                            >{i18n.lang === "zh" ? "或使用以下方式登录" : "Or continue with"}</span
                        >
                    </div>
                </div>

                <div class="mt-4 grid grid-cols-3 gap-3">
                    <!-- GitHub -->
                    <a
                        href={`${API_BASE.replace("/api", "")}/api/auth/github`}
                        aria-label="Login with GitHub"
                        class="flex items-center justify-center px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-white text-sm transition-all"
                    >
                        <svg
                            class="w-5 h-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
                            />
                        </svg>
                    </a>

                    <!-- Discord -->
                    <a
                        href={`${API_BASE.replace("/api", "")}/api/auth/discord`}
                        aria-label="Login with Discord"
                        class="flex items-center justify-center px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-white text-sm transition-all"
                    >
                        <svg
                            class="w-5 h-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
                            />
                        </svg>
                    </a>

                    <!-- Telegram -->
                    <a
                        href={`${API_BASE.replace("/api", "")}/api/auth/telegram`}
                        aria-label="Login with Telegram"
                        class="flex items-center justify-center px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-white text-sm transition-all"
                    >
                        <svg
                            class="w-5 h-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
                            />
                        </svg>
                    </a>
                </div>
            </div>

            <p class="text-xs text-slate-500 text-center mt-6">
                Default credentials: <span class="text-slate-400 font-mono"
                    >admin / admin123</span
                >
            </p>

            <p
                class="text-xs text-slate-500 text-center mt-4 border-t border-white/5 pt-4"
            >
                Don't have an account? <a
                    href="/register"
                    class="text-indigo-400 hover:underline">Register here</a
                >
            </p>
        </div>
    </div>
</div>
