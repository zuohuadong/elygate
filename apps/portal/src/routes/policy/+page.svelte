<script lang="ts">
    import { ShieldCheck, Globe, Cpu, Bell, Save, AlertTriangle } from 'lucide-svelte';
    import type { PortalOrg, PortalPolicy } from '$lib/types';

    type PolicyPageData = {
        org: PortalOrg;
        policy: PortalPolicy;
    };

    let { data }: { data: PolicyPageData } = $props();

    let policy = $state<PortalPolicy>({
        allowedModels: [],
        deniedModels: [],
        allowedSubnets: '',
        quotaAlarmThreshold: 80
    });
    let saving = $state(false);

    $effect(() => {
        policy = structuredClone(data.policy);
    });

    async function savePolicy() {
        saving = true;
        // In a real app, this would be a form action or an API call
        await new Promise(r => setTimeout(r, 1000));
        saving = false;
        alert('Policy updated successfully!');
    }
</script>

<div class="max-w-4xl space-y-8">
    <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck class="text-blue-500" />
            Organization Policies
        </h2>
        <button 
            onclick={savePolicy}
            disabled={saving}
            class="btn-primary flex items-center gap-2"
        >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Changes'}
        </button>
    </div>

    <!-- Security Section -->
    <div class="glass-card p-8 space-y-6">
        <div class="flex items-center gap-3 border-b border-[#30363d] pb-4">
            <Globe class="text-gray-400" size={20} />
            <div>
                <h3 class="text-lg font-semibold text-white">Network Security</h3>
                <p class="text-xs text-gray-500">Restricts API access to specific IP ranges for all users in this org.</p>
            </div>
        </div>

        <div class="space-y-4">
            <label class="block">
                <span class="text-sm font-medium text-gray-300">Allowed IP Ranges (CIDR)</span>
                <textarea 
                    bind:value={policy.allowedSubnets}
                    placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8"
                    class="mt-2 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-sm font-mono focus:border-blue-500 outline-none transition-all h-24"
                ></textarea>
                <span class="text-[10px] text-gray-600">Leave blank to allow all IPs. Separate multiple ranges with commas.</span>
            </label>
        </div>
    </div>

    <!-- Model Control Section -->
    <div class="glass-card p-8 space-y-6">
        <div class="flex items-center gap-3 border-b border-[#30363d] pb-4">
            <Cpu class="text-gray-400" size={20} />
            <div>
                <h3 class="text-lg font-semibold text-white">Model Restrictions</h3>
                <p class="text-xs text-gray-500">Control which models your team members can use.</p>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="space-y-4">
                <h4 class="text-sm font-medium text-red-400 flex items-center gap-2">
                    <AlertTriangle size={14} /> Denied Models
                </h4>
                <div class="flex flex-wrap gap-2">
                    {#each ['gpt-4-32k', 'claude-3-opus'] as m}
                        <label class="flex items-center gap-2 px-3 py-1.5 bg-red-500/5 border border-red-500/20 rounded-md text-xs cursor-pointer hover:bg-red-500/10 transition-all">
                            <input type="checkbox" class="accent-red-500" checked />
                            {m}
                        </label>
                    {/each}
                    <button class="px-3 py-1.5 border border-[#30363d] border-dashed rounded-md text-xs text-gray-500 hover:text-white transition-all">+ Add Model</button>
                </div>
            </div>

            <div class="space-y-4">
                <h4 class="text-sm font-medium text-gray-400">Policy Behavior</h4>
                <div class="space-y-3">
                    <label class="flex items-center gap-3 cursor-pointer group">
                        <input type="radio" name="policy_type" class="accent-blue-500" checked />
                        <div>
                            <p class="text-sm text-white group-hover:text-blue-400 transition-colors">Blacklist Mode</p>
                            <p class="text-[10px] text-gray-500">Allow all models except those in the denied list.</p>
                        </div>
                    </label>
                    <label class="flex items-center gap-3 cursor-pointer group">
                        <input type="radio" name="policy_type" class="accent-blue-500" />
                        <div>
                            <p class="text-sm text-white group-hover:text-blue-400 transition-colors">Whitelist Mode</p>
                            <p class="text-[10px] text-gray-500">Only allow models explicitly listed in the allowed list.</p>
                        </div>
                    </label>
                </div>
            </div>
        </div>
    </div>

    <!-- Notifications Section -->
    <div class="glass-card p-8 space-y-6">
        <div class="flex items-center gap-3 border-b border-[#30363d] pb-4">
            <Bell class="text-gray-400" size={20} />
            <div>
                <h3 class="text-lg font-semibold text-white">Usage Alerts</h3>
                <p class="text-xs text-gray-500">Get notified when organization quota reaches a threshold.</p>
            </div>
        </div>

        <div class="flex items-center gap-8">
            <div class="flex-1">
                <div class="flex justify-between mb-2">
                    <span class="text-sm text-gray-400">Alarm Threshold</span>
                    <span class="text-sm font-bold text-blue-500">{policy.quotaAlarmThreshold}%</span>
                </div>
                <input 
                    type="range" 
                    min="10" 
                    max="100" 
                    step="5"
                    bind:value={policy.quotaAlarmThreshold}
                    class="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
            </div>
            <div class="w-32 text-[10px] text-gray-500">
                Current usage is at <span class="text-white">{(data.org.usedQuota / data.org.totalQuota * 100).toFixed(1)}%</span>
            </div>
        </div>
    </div>
</div>
