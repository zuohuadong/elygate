<script lang="ts">
    import '../app.css';
    import { page } from '$app/state';
    import { LayoutDashboard, Users, ShieldCheck, Settings, LogOut, Activity } from '@lucide/svelte';
    
    let { data, children } = $props();
    
    const navItems = [
        { name: 'Dashboard', path: '/', icon: LayoutDashboard },
        { name: 'Audit Logs', path: '/logs', icon: Activity },
        { name: 'Team Members', path: '/members', icon: Users },
        { name: 'Policy Control', path: '/policy', icon: ShieldCheck },
        { name: 'Org Settings', path: '/settings', icon: Settings }
    ];

    const currentPath = $derived(page.url.pathname);
</script>

{#if data.user}
<div class="flex min-h-screen bg-[#0d1117] text-gray-200">
    <!-- Sidebar -->
    <aside class="w-64 border-r border-[#30363d] bg-[#0d1117] flex flex-col sticky top-0 h-screen">
        <div class="p-6">
            <div class="flex items-center gap-3 mb-8">
                <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
                    E
                </div>
                <span class="text-xl font-bold tracking-tight text-white">Elygate <span class="text-blue-500">Portal</span></span>
            </div>

            <nav class="space-y-1">
                {#each navItems as item}
                    <a 
                        href={item.path}
                        class="nav-item {currentPath === item.path ? 'nav-item-active' : ''}"
                    >
                        <item.icon size={20} />
                        <span>{item.name}</span>
                    </a>
                {/each}
            </nav>
        </div>

        <div class="mt-auto p-6 border-t border-[#30363d]">
            <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold animate-pulse">
                    {data.user.username[0].toUpperCase()}
                </div>
                <div class="overflow-hidden">
                    <p class="text-sm font-medium text-white truncate">{data.user.username}</p>
                    <p class="text-xs text-gray-400 truncate">{data.org?.name}</p>
                </div>
            </div>
            <button class="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors">
                <LogOut size={16} />
                <span>Sign Out</span>
            </button>
        </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <!-- Top Bar -->
        <header class="h-16 border-b border-[#30363d] bg-[#0d1117]/50 backdrop-blur-sm flex items-center justify-between px-8 sticky top-0 z-10">
            <h2 class="text-lg font-semibold text-white">
                {navItems.find(i => i.path === currentPath)?.name || 'Portal'}
            </h2>

            <div class="flex items-center gap-6">
                <div class="flex flex-col items-end">
                    <span class="text-xs text-gray-400">Org Quota Usage</span>
                    <div class="flex items-center gap-2">
                        <div class="w-32 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div 
                                class="h-full bg-blue-500 rounded-full" 
                                style="width: {data.org ? (data.org.usedQuota / data.org.totalQuota * 100).toFixed(1) : 0}%"
                            ></div>
                        </div>
                        <span class="text-xs font-mono">{data.org ? (data.org.usedQuota / data.org.totalQuota * 100).toFixed(1) : 0}%</span>
                    </div>
                </div>
            </div>
        </header>

        <div class="p-8">
            {@render children()}
        </div>
    </main>
</div>
{:else}
    {@render children()}
{/if}

<style>
    :global(body) {
        overflow: hidden;
    }
</style>
