<script lang="ts">
    
    import { API_BASE, apiFetch } from "$lib/api";
    import { goto } from "$app/navigation";
    import { i18n } from "$lib/i18n/index.svelte";

    let username = $state("");
    let password = $state("");
    let confirmPassword = $state("");
    let inviteCode = $state("");
    let isLoading = $state(false);
    let isChecking = $state(true);
    let registerMode = $state("open");
    let error = $state("");
    let success = $state("");

    $effect(() => { (async () => {
        try {
            const res = await fetch(`${API_BASE}/api/option`);
            const data = await res.json();
            if (data.success) {
                registerMode = data.data.RegisterMode || "open";
            }
        } catch (e) {
            console.error("Failed to fetch registration status", e);
        } finally {
            isChecking = false;
        }
    })(); });

    async function handleRegister(e: Event) {
        e.preventDefault();
        if (registerMode === "closed") {
            error =
                i18n.lang === "zh"
                    ? "注册功能已关闭"
                    : "Registration is currently disabled.";
            return;
        }
        if (isLoading) return;
        error = "";
        success = "";

        if (password !== confirmPassword) {
            error =
                i18n.lang === "zh"
                    ? "两次输入的密码不一致"
                    : "Passwords do not match";
            return;
        }

        if (registerMode === "invite" && !inviteCode) {
            error =
                i18n.lang === "zh"
                    ? "注册需要邀请码"
                    : "Invite code is required for registration";
            return;
        }

        isLoading = true;
        try {
            const data = await apiFetch<{success?: boolean, message?: string, token?: string, user?: Record<string, any>, [key: string]: any}>("/register", {
                method: "POST",
                body: JSON.stringify({
                    username,
                    password,
                    inviteCode: inviteCode || undefined,
                }),
            });

            if (!data || !data.success) {
                throw new Error(
                    data.message ||
                        (i18n.lang === "zh"
                            ? "注册失败"
                            : "Registration failed"),
                );
            }

            success =
                i18n.lang === "zh"
                    ? "注册成功！正在跳转到登录页面..."
                    : "Registration successful! Redirecting to login...";
            setTimeout(() => {
                goto("/login");
            }, 2000);
        } catch (e: unknown) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            isLoading = false;
        }
    }
</script>

<svelte:head>
    <title>Elygate – Register</title>
</svelte:head>

<div
    class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 relative overflow-hidden"
>
    <div
        class="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none"
    ></div>
    <div
        class="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/15 rounded-full blur-3xl pointer-events-none"
    ></div>

    <div class="relative z-10 w-full max-w-md px-6">
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
            <p class="text-slate-400 text-sm mt-1">
                {i18n.lang === "zh" ? "创建您的账户" : "Create your account"}
            </p>
        </div>

        <div
            class="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
            <h2 class="text-lg font-semibold text-white mb-6">
                {i18n.lang === "zh" ? "注册" : "Register"}
            </h2>

            {#if registerMode === "closed" && !isChecking}
                <div
                    class="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 mb-6"
                >
                    {i18n.lang === "zh"
                        ? "注册功能已被管理员关闭"
                        : "Registration is currently disabled by administrator."}
                </div>
            {/if}

            <form onsubmit={handleRegister} class="space-y-5">
                <fieldset
                    disabled={registerMode === "closed" || isLoading}
                    class="space-y-5 border-none p-0 m-0"
                >
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
                            placeholder={i18n.lang === "zh"
                                ? "请输入用户名"
                                : "Your username"}
                            class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
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
                            placeholder="••••••••"
                            class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                        />
                    </div>
                    <div>
                        <label
                            for="confirm-password"
                            class="block text-sm font-medium text-slate-300 mb-1.5"
                            >{i18n.lang === "zh"
                                ? "确认密码"
                                : "Confirm Password"}</label
                        >
                        <input
                            id="confirm-password"
                            type="password"
                            bind:value={confirmPassword}
                            required
                            placeholder="••••••••"
                            class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                        />
                    </div>
                    <div>
                        <label
                            for="invite-code"
                            class="block text-sm font-medium text-slate-300 mb-1.5"
                        >
                            {i18n.lang === "zh" ? "邀请码" : "Invite Code"}
                            {#if registerMode === "invite"}
                                <span class="text-rose-400">*</span>
                            {:else}
                                <span class="text-slate-500 text-xs"
                                    >({i18n.lang === "zh"
                                        ? "可选，使用邀请码可获得额外额度"
                                        : "Optional, get bonus quota with invite code"})</span
                                >
                            {/if}
                        </label>
                        <input
                            id="invite-code"
                            type="text"
                            bind:value={inviteCode}
                            placeholder={i18n.lang === "zh"
                                ? "请输入邀请码"
                                : "Enter invite code"}
                            class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                        />
                    </div>

                    {#if error}
                        <div
                            class="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3"
                        >
                            {error}
                        </div>
                    {/if}

                    {#if success}
                        <div
                            class="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3"
                        >
                            {success}
                        </div>
                    {/if}

                    <button
                        type="submit"
                        disabled={isLoading}
                        class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-medium rounded-xl text-sm transition-all duration-200"
                    >
                        {isLoading
                            ? i18n.lang === "zh"
                                ? "注册中..."
                                : "Registering..."
                            : i18n.lang === "zh"
                              ? "注册"
                              : "Register"}
                    </button>
                </fieldset>
            </form>

            <p class="text-xs text-slate-500 text-center mt-6">
                {i18n.lang === "zh" ? "已有账户？" : "Already have an account?"}
                <a href="/login" class="text-indigo-400 hover:underline"
                    >{i18n.lang === "zh" ? "立即登录" : "Sign in"}</a
                >
            </p>
        </div>
    </div>
</div>
