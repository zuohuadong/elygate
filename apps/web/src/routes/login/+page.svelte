<script lang="ts">
    import { API_BASE, setToken } from "$lib/api";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";

    let username = $state("admin");
    let password = $state("");
    let isLoading = $state(false);
    let error = $state("");

    onMount(() => {
        // already logged in — go to dashboard
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
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Login failed");
            setToken(data.token);
            localStorage.setItem("admin_username", data.username);
            goto("/");
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
            <p class="text-slate-400 text-sm mt-1">AI API Gateway Management</p>
        </div>

        <!-- Card -->
        <div
            class="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
            <h2 class="text-lg font-semibold text-white mb-6">
                Sign in to continue
            </h2>

            <form onsubmit={handleLogin} class="space-y-5">
                <div>
                    <label
                        for="username"
                        class="block text-sm font-medium text-slate-300 mb-1.5"
                        >Username</label
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
                        >Password</label
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
                            Signing in…
                        </span>
                    {:else}
                        Sign in
                    {/if}
                </button>
            </form>

            <p class="text-xs text-slate-500 text-center mt-6">
                Default credentials: <span class="text-slate-400 font-mono"
                    >admin / admin123</span
                >
            </p>
        </div>
    </div>
</div>
