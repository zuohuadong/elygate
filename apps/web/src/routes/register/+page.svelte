<script lang="ts">
    import { API_BASE } from "$lib/api";
    import { goto } from "$app/navigation";

    let username = $state("");
    let password = $state("");
    let confirmPassword = $state("");
    let isLoading = $state(false);
    let error = $state("");
    let success = $state("");

    async function handleRegister(e: Event) {
        e.preventDefault();
        if (isLoading) return;
        error = "";
        success = "";

        if (password !== confirmPassword) {
            error = "Passwords do not match";
            return;
        }

        isLoading = true;
        try {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Registration failed");

            success = "Registration successful! Redirecting to login...";
            setTimeout(() => {
                goto("/login");
            }, 2000);
        } catch (e: any) {
            error = e.message;
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
            <p class="text-slate-400 text-sm mt-1">Create your account</p>
        </div>

        <div
            class="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
            <h2 class="text-lg font-semibold text-white mb-6">Register</h2>

            <form onsubmit={handleRegister} class="space-y-5">
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
                        placeholder="Your username"
                        class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
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
                        placeholder="••••••••"
                        class="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                </div>
                <div>
                    <label
                        for="confirm-password"
                        class="block text-sm font-medium text-slate-300 mb-1.5"
                        >Confirm Password</label
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
                    {isLoading ? "Registering..." : "Register"}
                </button>
            </form>

            <p class="text-xs text-slate-500 text-center mt-6">
                Already have an account? <a
                    href="/login"
                    class="text-indigo-400 hover:underline">Sign in</a
                >
            </p>
        </div>
    </div>
</div>
