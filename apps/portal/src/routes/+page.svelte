<script lang="ts">
    import { Users, CreditCard, Activity, ArrowUpRight } from 'lucide-svelte';
    import type { PortalOrg } from '$lib/types';

    type DashboardData = {
        org: PortalOrg;
    };

    let { data }: { data: DashboardData } = $props();

    let stats = $derived([
        { name: 'Total Quota', value: `$${(data.org.totalQuota / 1000000).toFixed(2)}M`, icon: CreditCard, color: 'text-blue-500' },
        { name: 'Used Quota', value: `$${(data.org.usedQuota / 1000000).toFixed(2)}M`, icon: Activity, color: 'text-purple-500' },
        { name: 'Active Members', value: '12', icon: Users, color: 'text-green-500' }
    ]);
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

    <!-- Usage Trend Placeholder -->
    <div class="glass-card p-6">
        <div class="flex items-center justify-between mb-6">
            <h3 class="text-lg font-semibold text-white">Organization Usage Trend</h3>
            <button class="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1">
                View Detailed Stats <ArrowUpRight size={14} />
            </button>
        </div>
        <div class="h-64 flex items-end gap-2 px-2">
            {#each Array(24) as _, i}
                <div 
                    class="flex-1 bg-gradient-to-t from-blue-600/50 to-blue-400/80 rounded-t-sm transition-all hover:to-white"
                    style="height: {Math.random() * 80 + 20}%"
                ></div>
            {/each}
        </div>
        <div class="flex justify-between mt-4 text-[10px] text-gray-500 font-mono">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:59</span>
        </div>
    </div>
</div>
