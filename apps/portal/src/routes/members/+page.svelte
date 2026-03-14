<script lang="ts">
    import { Users, UserPlus, Shield, TrendingDown, MoreVertical, Search, Filter } from 'lucide-svelte';
    import type { PortalMember } from '$lib/types';

    type MembersPageData = {
        members: PortalMember[];
    };
    
    let { data }: { data: MembersPageData } = $props();

    let searchQuery = $state('');
    let filteredMembers = $derived(
        data.members.filter((member) => member.username.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const getRoleBadge = (role: number) => {
        if (role >= 10) return 'bg-red-500/10 text-red-400 border-red-500/20';
        if (role >= 5) return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    };

    const getRoleName = (role: number) => {
        if (role >= 10) return 'Org Owner';
        if (role >= 5) return 'Manager';
        return 'Member';
    };
</script>

<div class="space-y-6">
    <!-- Action Bar -->
    <div class="flex items-center justify-between gap-4">
        <div class="flex-1 relative max-w-md">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input 
                type="text" 
                bind:value={searchQuery}
                placeholder="Search by username or email..."
                class="w-full bg-[#161b22] border border-[#30363d] rounded-lg py-2 pl-10 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm outline-none"
            />
        </div>
        <div class="flex items-center gap-3">
            <button class="flex items-center gap-2 px-3 py-2 bg-white/5 border border-[#30363d] rounded-lg text-sm hover:bg-white/10 transition-all">
                <Filter size={16} />
                Filters
            </button>
            <button class="btn-primary flex items-center gap-2">
                <UserPlus size={18} />
                Invite Member
            </button>
        </div>
    </div>

    <!-- Members Table -->
    <div class="glass-card overflow-hidden">
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="border-b border-[#30363d] bg-white/[0.02]">
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Member</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Quota Status</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Usage</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-[#30363d]">
                {#each filteredMembers as member}
                    <tr class="hover:bg-white/[0.02] transition-colors group">
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                                    {member.username[0].toUpperCase()}
                                </div>
                                <div>
                                    <p class="text-sm font-medium text-white">{member.username}</p>
                                    <p class="text-xs text-gray-500">Last active 2h ago</p>
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border {getRoleBadge(member.role)}">
                                {getRoleName(member.role)}
                            </span>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex flex-col gap-1 w-32">
                                <div class="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                    <div 
                                        class="h-full bg-blue-500 rounded-full" 
                                        style="width: {(member.quota > 0 ? (member.usedQuota / member.quota) * 100 : 0).toFixed(1)}%"
                                    ></div>
                                </div>
                                <span class="text-[10px] font-mono text-gray-500">
                                    {(member.usedQuota / 1000000).toFixed(2)}M / {(member.quota / 1000000).toFixed(2)}M
                                </span>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-1 text-xs text-green-400">
                                <TrendingDown size={14} />
                                -12% vs last week
                            </div>
                        </td>
                        <td class="px-6 py-4 text-right">
                            <button class="p-1 text-gray-500 hover:text-white transition-colors">
                                <MoreVertical size={18} />
                            </button>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</div>
