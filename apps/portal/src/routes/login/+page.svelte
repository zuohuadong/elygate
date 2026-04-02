<script lang="ts">
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { LogIn, Key, Loader2, AlertCircle } from 'lucide-svelte';

    let username = $state('');
    let password = $state('');
    let loading = $state(false);
    let errorMessage = $state('');

    async function handleLogin(e: Event) {
        e.preventDefault();
        
        if (!username || !password) {
            errorMessage = 'Please enter both username and password';
            return;
        }

        loading = true;
        errorMessage = '';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                // SvelteKit cookie (auth_session) is set automatically by the server response
                // Redirect immediately back to the portal home
                window.location.href = '/'; 
            } else {
                errorMessage = data.message || 'Login failed, please check your credentials';
            }
        } catch (err: any) {
            errorMessage = err.message || 'Network error, please try again later';
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
    <title>Login - Elygate Portal</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-[#0d1117] text-gray-200 p-6">
    <div class="w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden relative">
        <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-600"></div>
        
        <div class="p-8">
            <div class="flex items-center gap-3 mb-8 justify-center">
                <div class="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
                    E
                </div>
                <span class="text-2xl font-bold tracking-tight text-white">Elygate <span class="text-blue-500">Portal</span></span>
            </div>

            <div class="text-center mb-8">
                <h1 class="text-xl font-bold text-white mb-2">Sign in to your account</h1>
                <p class="text-sm text-gray-400">Enterprise portal access requires authorization</p>
            </div>

            {#if errorMessage}
                <div class="mb-6 p-4 rounded-lg bg-red-900/30 border border-red-500/30 flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p class="text-sm text-red-200">{errorMessage}</p>
                </div>
            {/if}

            <form onsubmit={handleLogin} class="space-y-6">
                <div>
                    <label for="username" class="block text-sm font-medium text-gray-300 mb-2">Username</label>
                    <div class="relative relative-group">
                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                            <Key size={18} />
                        </div>
                        <input
                            id="username"
                            type="text"
                            bind:value={username}
                            disabled={loading}
                            class="block w-full pl-10 pr-3 py-3 border border-[#30363d] rounded-xl bg-[#0d1117] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all disabled:opacity-50"
                            placeholder="username"
                            required
                        />
                    </div>
                </div>

                <div>
                    <label for="password" class="block text-sm font-medium text-gray-300 mb-2">Password</label>
                    <input
                        id="password"
                        type="password"
                        bind:value={password}
                        disabled={loading}
                        class="block w-full px-4 py-3 border border-[#30363d] rounded-xl bg-[#0d1117] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all disabled:opacity-50"
                        placeholder="••••••••"
                        required
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    class="w-full flex items-center justify-center gap-2 px-4 py-3 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#161b22] focus:ring-blue-500 transition-all disabled:opacity-75 disabled:cursor-not-allowed"
                >
                    {#if loading}
                        <Loader2 size={18} class="animate-spin" />
                        <span>Authenticating...</span>
                    {:else}
                        <LogIn size={18} />
                        <span>Sign In</span>
                    {/if}
                </button>
            </form>
            
            <div class="mt-8 text-center text-xs text-gray-500">
                <p>&copy; {new Date().getFullYear()} Elygate Foundation. All rights reserved.</p>
            </div>
        </div>
    </div>
</div>
