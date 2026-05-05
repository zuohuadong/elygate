<script lang="ts">
    import { ShieldCheck, Globe, Cpu, Bell, Save, AlertTriangle, CheckCircle2 } from '@lucide/svelte';
    import { enhance } from '$app/forms';
    import type { PortalOrg, PortalPolicy } from '$lib/types';

    type PolicyPageData = {
        org: PortalOrg;
        policy: PortalPolicy;
        availableModels: string[];
    };

    let { data }: { data: PolicyPageData } = $props();

    let policy = $state<PortalPolicy>({
        allowedModels: [],
        deniedModels: [],
        allowedSubnets: '',
        alertThresholdPct: 80,
        alertWebhookUrl: ''
    });
    let saving = $state(false);
    let showSuccess = $state(false);

    $effect(() => {
        policy = structuredClone(data.policy);
    });

    const toggleModel = (list: 'allowedModels' | 'deniedModels', model: string) => {
        if (policy[list].includes(model)) {
            policy[list] = policy[list].filter(m => m !== model);
        } else {
            policy[list] = [...policy[list], model];
        }
    };
</script>

<div class="max-w-4xl space-y-8">
    <form 
        method="POST" 
        action="?/updatePolicy"
        use:enhance={() => {
            saving = true;
            return async ({ result }) => {
                saving = false;
                if (result.type === 'success') {
                    showSuccess = true;
                    setTimeout(() => showSuccess = false, 3000);
                }
            };
        }}
        class="space-y-8"
    >
        <div class="flex items-center justify-between sticky top-0 z-10 py-4 bg-[#0d1117]/80 backdrop-blur-md">
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
                <ShieldCheck class="text-blue-500" />
                Organization Policies
            </h2>
            <div class="flex items-center gap-4">
                {#if showSuccess}
                    <div class="flex items-center gap-2 text-green-400 text-sm animate-in fade-in slide-in-from-right-4">
                        <CheckCircle2 size={16} />
                        Saved!
                    </div>
                {/if}
                <button 
                    type="submit"
                    disabled={saving}
                    class="btn-primary flex items-center gap-2"
                >
                    <Save size={18} />
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>

        <!-- Hidden serializations -->
        <input type="hidden" name="allowedModels" value={JSON.stringify(policy.allowedModels)} />
        <input type="hidden" name="deniedModels" value={JSON.stringify(policy.deniedModels)} />
        <input type="hidden" name="alertThresholdPct" value={policy.alertThresholdPct} />

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
                        name="allowedSubnets"
                        bind:value={policy.allowedSubnets}
                        placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8"
                        class="mt-2 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-sm font-mono focus:border-blue-500 outline-none transition-all h-24"
                    ></textarea>
                    <span class="text-[10px] text-gray-600">Leave blank to allow all IPs. Separate multiple ranges with commas or newlines.</span>
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
                        <AlertTriangle size={14} /> Denied Models (Blacklist)
                    </h4>
                    <div class="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                        {#each data.availableModels as m}
                            <label class="flex items-center justify-between px-3 py-2 bg-red-500/5 border {policy.deniedModels.includes(m) ? 'border-red-500/50 bg-red-500/10' : 'border-white/5'} rounded-md text-xs cursor-pointer hover:bg-red-500/10 transition-all">
                                <span class="text-gray-300">{m}</span>
                                <input 
                                    type="checkbox" 
                                    checked={policy.deniedModels.includes(m)} 
                                    onclick={() => toggleModel('deniedModels', m)}
                                    class="accent-red-500" 
                                />
                            </label>
                        {/each}
                    </div>
                </div>

                <div class="space-y-4">
                    <h4 class="text-sm font-medium text-green-400 flex items-center gap-2">
                        <CheckCircle2 size={14} /> Explicitly Allowed (Whitelist)
                    </h4>
                    <div class="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                        {#each data.availableModels as m}
                            <label class="flex items-center justify-between px-3 py-2 bg-green-500/5 border {policy.allowedModels.includes(m) ? 'border-green-500/50 bg-green-500/10' : 'border-white/5'} rounded-md text-xs cursor-pointer hover:bg-green-500/10 transition-all">
                                <span class="text-gray-300">{m}</span>
                                <input 
                                    type="checkbox" 
                                    checked={policy.allowedModels.includes(m)} 
                                    onclick={() => toggleModel('allowedModels', m)}
                                    class="accent-green-500" 
                                />
                            </label>
                        {/each}
                    </div>
                </div>
            </div>
            <p class="text-[10px] text-gray-500 italic">Note: Blacklist is checked first. If a model is in both lists, it will be BLOCKED. Whitelist only takes effect if not empty.</p>
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

            <div class="space-y-6">
                <div class="flex items-center gap-8">
                    <div class="flex-1">
                        <div class="flex justify-between mb-2">
                            <span class="text-sm text-gray-400">Alarm Threshold</span>
                            <span class="text-sm font-bold text-blue-500">{policy.alertThresholdPct}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="10" 
                            max="100" 
                            step="5"
                            bind:value={policy.alertThresholdPct}
                            class="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>
                    <div class="w-32 text-[10px] text-gray-500">
                        Current usage at <span class="text-white">{(data.org.usedQuota / Math.max(data.org.totalQuota, 1) * 100).toFixed(1)}%</span>
                    </div>
                </div>

                <div class="space-y-2">
                    <label class="block">
                        <span class="text-sm font-medium text-gray-300">Webhook URL (Slack/Web)</span>
                        <input 
                            type="url"
                            name="alertWebhookUrl"
                            bind:value={policy.alertWebhookUrl}
                            placeholder="https://hooks.slack.com/services/..."
                            class="mt-2 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-xs focus:border-blue-500 outline-none transition-all"
                        />
                    </label>
                    <span class="text-[10px] text-gray-600">POST request will be sent to this URL when threshold is hit.</span>
                </div>
            </div>
        </div>
    </form>
</div>

<style>
    .custom-scrollbar::-webkit-scrollbar {
        width: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #30363d;
        border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: #484f58;
    }
</style>
