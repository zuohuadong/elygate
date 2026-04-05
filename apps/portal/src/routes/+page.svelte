<script lang="ts">
    import { Users, CreditCard, Activity, ArrowUpRight, BarChart3, PieChart, AlertCircle, Zap } from '@lucide/svelte';
    import type { PortalOrg } from '$lib/types';

    type DashboardData = {
        org: PortalOrg;
        analytics: {
            usageTrend: { label: string; cost: number; errors: number; latency: number }[];
            modelDistribution: { name: string; value: number }[];
            errorStats: { code: number; count: number }[];
            activeMembers: number;
        };
    };

    let { data }: { data: DashboardData } = $props();

    let stats = $derived([
        { name: 'Total Quota', value: `$${(data.org.totalQuota / 1000000).toFixed(2)}M`, icon: CreditCard, color: 'text-blue-500' },
        { name: 'Used Quota', value: `$${(data.org.usedQuota / 1000000).toFixed(2)}M`, icon: Activity, color: 'text-purple-500' },
        { name: 'Active Members', value: data.analytics.activeMembers.toString(), icon: Users, color: 'text-green-500' }
    ]);

    let maxCost = $derived(Math.max(...data.analytics.usageTrend.map(t => t.cost), 1));
    let maxErrors = $derived(Math.max(...data.analytics.usageTrend.map(t => t.errors), 1));
</script>

<div class="space-y-8">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {#each stats as stat}
            <div class="glass-card glass-card-hover p-6">
                <div class="flex items-center justify-between mb-4">
                    <div class="p-2 bg-white/5 rounded-lg {stat.color}">
                        <stat.icon size={24} />
                    </div>
                </div>
                <div>
                    <p class="text-sm text-gray-400 font-medium">{stat.name}</p>
                    <h3 class="text-2xl font-bold text-white mt-1">{stat.value}</h3>
                </div>
            </div>
        {/each}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Usage & Health Trend -->
        <div class="glass-card p-6 lg:col-span-2">
            <div class="flex items-center justify-between mb-6">
                <div class="flex items-center gap-2">
                    <BarChart3 size={18} class="text-blue-400" />
                    <h3 class="text-lg font-semibold text-white">24h Health & Usage</h3>
                </div>
                <div class="flex items-center gap-4 text-[10px]">
                    <span class="flex items-center gap-1 text-blue-400"><div class="w-2 h-2 rounded-full bg-blue-400"></div> Cost</span>
                    <span class="flex items-center gap-1 text-red-400"><div class="w-2 h-2 rounded-full bg-red-400"></div> Errors</span>
                </div>
            </div>
            
            <div class="h-64 flex items-end gap-1.5 px-2 relative">
                {#each data.analytics.usageTrend as hour}
                    <div class="flex-1 flex flex-col items-center gap-1 group relative">
                        <!-- Tooltip -->
                        <div class="absolute -top-16 left-1/2 -translate-x-1/2 px-3 py-2 bg-gray-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none border border-white/10 shadow-xl">
                            <div class="font-bold border-b border-white/5 pb-1 mb-1">{hour.label}</div>
                            <div class="flex justify-between gap-4"><span>Cost:</span> <span class="text-blue-400">${hour.cost.toFixed(2)}</span></div>
                            <div class="flex justify-between gap-4"><span>Errors:</span> <span class="text-red-400">{hour.errors}</span></div>
                            <div class="flex justify-between gap-4"><span>Latency:</span> <span class="text-yellow-400">{hour.latency}ms</span></div>
                        </div>

                        <!-- Error Bar (Background) -->
                        <div 
                            class="w-full bg-red-500/20 rounded-t-[2px] absolute bottom-0 transition-all group-hover:bg-red-500/40"
                            style="height: {(hour.errors / maxErrors) * 100}%"
                        ></div>

                        <!-- Cost Bar -->
                        <div 
                            class="w-full bg-gradient-to-t from-blue-600/40 to-blue-400/90 rounded-t-[2px] transition-all group-hover:to-white z-10"
                            style="height: {(hour.cost / maxCost) * 100}%"
                        ></div>
                    </div>
                {/each}
            </div>
            <div class="flex justify-between mt-4 text-[10px] text-gray-500 font-mono border-t border-white/5 pt-2">
                <span>{data.analytics.usageTrend[0]?.label || '00:00'}</span>
                <span>{data.analytics.usageTrend[Math.floor(data.analytics.usageTrend.length / 2)]?.label || '12:00'}</span>
                <span>{data.analytics.usageTrend[data.analytics.usageTrend.length - 1]?.label || '23:00'}</span>
            </div>
        </div>

        <!-- Model Distribution -->
        <div class="glass-card p-6">
            <div class="flex items-center gap-2 mb-6">
                <PieChart size={18} class="text-purple-400" />
                <h3 class="text-lg font-semibold text-white">Top Models</h3>
            </div>
            
            <div class="space-y-4">
                {#each data.analytics.modelDistribution as model, i}
                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-gray-300 truncate max-w-[150px]">{model.name}</span>
                            <span class="text-gray-500 font-mono">{model.value} calls</span>
                        </div>
                        <div class="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div 
                                class="h-full rounded-full {['bg-blue-500', 'bg-purple-500', 'bg-indigo-500', 'bg-cyan-500', 'bg-teal-500'][i % 5]}"
                                style="width: {(model.value / data.analytics.modelDistribution[0].value) * 100}%"
                            ></div>
                        </div>
                    </div>
                {:else}
                    <div class="h-full flex items-center justify-center text-gray-600 text-sm italic">
                        No usage data yet
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>
