<script lang="ts">
    
    import { Activity, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-svelte';
    import { apiFetch } from '$lib/api';

    let channels = $state<any[]>([]);
    let isLoading = $state(true);
    let lastUpdated = $state(new Date());

    async function fetchStatus() {
        try {
            const data = await apiFetch<any[]>('/status');
            channels = data;
            lastUpdated = new Date();
        } catch (e) {
            console.error('Failed to fetch status:', e);
        } finally {
            isLoading = false;
        }
    }

    $effect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 30000); // 30s refresh
        return () => clearInterval(interval);
    });

    const getStatusInfo = (status: number) => {
        switch (status) {
            case 1:
                return { label: 'Operational', color: 'text-emerald-500', bg: 'bg-emerald-500/10', icon: CheckCircle2 };
            case 5:
                return { label: 'Busy', color: 'text-amber-500', bg: 'bg-amber-500/10', icon: Clock };
            case 4:
                return { label: 'Testing', color: 'text-indigo-500', bg: 'bg-indigo-500/10', icon: Activity };
            default:
                return { label: 'Offline', color: 'text-rose-500', bg: 'bg-rose-500/10', icon: XCircle };
        }
    };
</script>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
    <div class="max-w-4xl mx-auto space-y-8">
        <!-- Header -->
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div class="space-y-2">
                <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-500 text-xs font-bold uppercase tracking-wider">
                    <Activity size={14} />
                    System Status
                </div>
                <h1 class="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Channel Health</h1>
                <p class="text-slate-500 dark:text-slate-400">Real-time status of all upstream API channels.</p>
            </div>
            <div class="text-xs text-slate-400 font-mono">
                Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
        </div>

        <!-- Overall Status Banner -->
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm overflow-hidden relative">
            <div class="flex items-center gap-4 relative z-10">
                {#if channels.every(c => c.status === 1)}
                    <div class="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                        <CheckCircle2 size={32} />
                    </div>
                    <div>
                        <h2 class="text-lg font-bold text-slate-900 dark:text-white">All Systems Operational</h2>
                        <p class="text-sm text-slate-500">Elygate is performing at optimal capacity.</p>
                    </div>
                {:else if channels.some(c => c.status === 1)}
                    <div class="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
                        <AlertTriangle size={32} />
                    </div>
                    <div>
                        <h2 class="text-lg font-bold text-slate-900 dark:text-white">Partial Outage</h2>
                        <p class="text-sm text-slate-500">Some channels are experiencing issues or rate limiting.</p>
                    </div>
                {:else}
                    <div class="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-500">
                        <AlertTriangle size={32} />
                    </div>
                    <div>
                        <h2 class="text-lg font-bold text-slate-900 dark:text-white">Major Service Outage</h2>
                        <p class="text-sm text-slate-500">Most channels are currently down. Check back soon.</p>
                    </div>
                {/if}
            </div>
            <!-- Decorative background element -->
            <div class="absolute -right-4 -bottom-4 opacity-5 pointer-events-none">
                <Activity size={160} />
            </div>
        </div>

        <!-- Channel List -->
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
            <div class="divide-y divide-slate-100 dark:divide-slate-800/50">
                {#if isLoading}
                    {#each Array(5) as _}
                        <div class="p-6 flex items-center justify-between animate-pulse">
                            <div class="h-6 w-32 bg-slate-100 dark:bg-slate-800 rounded-md"></div>
                            <div class="h-6 w-24 bg-slate-100 dark:bg-slate-800 rounded-full"></div>
                        </div>
                    {/each}
                {:else}
                    {#each channels as channel}
                        {@const info = getStatusInfo(channel.status)}
                        <div class="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                            <div class="space-y-1">
                                <div class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                    {channel.name}
                                    {#if channel.statusMessage && channel.status !== 1}
                                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-normal uppercase">
                                            {channel.statusMessage}
                                        </span>
                                    {/if}
                                </div>
                                <div class="text-xs text-slate-400 font-mono">
                                    Provider Type: {channel.type}
                                </div>
                            </div>
                            <div class="flex items-center gap-2 px-4 py-1.5 rounded-full {info.bg} {info.color} text-xs font-bold ring-1 ring-inset ring-current/10">
                                <info.icon size={14} />
                                {info.label}
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>

        <!-- Footer Info -->
        <div class="text-center space-y-4 pt-4">
            <p class="text-sm text-slate-400">
                Elygate uses an intelligent circuit breaker system to automatically failover and recover channels.
            </p>
            <div class="flex justify-center gap-6">
                <a href="/" class="text-xs text-indigo-500 hover:text-indigo-400 font-medium">Back to Home</a>
                <a href="https://github.com/zuohuadong/elygate" target="_blank" class="text-xs text-slate-500 hover:text-slate-400 font-medium">GitHub</a>
            </div>
        </div>
    </div>
</div>

<style>
    /* Add any custom animations or styles if needed */
</style>
