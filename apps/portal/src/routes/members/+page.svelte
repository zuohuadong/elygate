<script lang="ts">
    import { Users, UserPlus, Shield, TrendingDown, MoreVertical, Search, Filter, Edit2, Trash2, X, CheckCircle2, AlertTriangle } from 'lucide-svelte';
    import { enhance } from '$app/forms';
    import type { PortalMember } from '$lib/types';

    type MembersPageData = {
        members: PortalMember[];
    };
    
    let { data }: { data: MembersPageData } = $props();

    let searchQuery = $state('');
    let filteredMembers = $derived(
        data.members.filter((member) => member.username.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Modal state
    let showingAddModal = $state(false);
    let editingMember = $state<PortalMember | null>(null);
    let deletingMember = $state<PortalMember | null>(null);
    let saving = $state(false);

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
            <button 
                onclick={() => showingAddModal = true}
                class="btn-primary flex items-center gap-2"
            >
                <UserPlus size={18} />
                Add Member
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
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-[#30363d]">
                {#each filteredMembers as member}
                    <tr class="hover:bg-white/[0.02] transition-colors group">
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-xs uppercase">
                                    {member.username[0]}
                                </div>
                                <div class="overflow-hidden">
                                    <p class="text-sm font-medium text-white truncate">{member.username}</p>
                                    <p class="text-[10px] text-gray-500">Joined {new Date(member.createdAt).toLocaleDateString()}</p>
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
                        <td class="px-6 py-4 text-right">
                            <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                    onclick={() => editingMember = structuredClone(member)}
                                    class="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-all"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button 
                                    onclick={() => deletingMember = member}
                                    class="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</div>

<!-- Add Modal -->
{#if showingAddModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div class="glass-card w-full max-w-md p-0 overflow-hidden shadow-2xl border-white/10">
            <div class="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
                <h3 class="text-lg font-bold text-white">Add New Member</h3>
                <button onclick={() => showingAddModal = false} class="p-1 text-gray-500 hover:text-white transition-colors">
                    <X size={20} />
                </button>
            </div>
            
            <form 
                method="POST" 
                action="?/addMember"
                use:enhance={() => {
                    saving = true;
                    return async ({ result }) => {
                        saving = false;
                        if (result.type === 'success') showingAddModal = false;
                    };
                }}
                class="p-6 space-y-6"
            >
                <div class="space-y-4">
                    <label class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Username / ID</span>
                        <input 
                            name="username"
                            required
                            placeholder="e.g. john_doe"
                            class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-sm text-white focus:border-blue-500 outline-none transition-all"
                        />
                    </label>

                    <label class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Initial Password</span>
                        <input 
                            type="password"
                            name="password"
                            minlength="8"
                            required
                            placeholder="At least 8 characters"
                            class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-sm text-white focus:border-blue-500 outline-none transition-all"
                        />
                    </label>

                    <label class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</span>
                        <select 
                            name="role" 
                            class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-sm text-white focus:border-blue-500 outline-none transition-all"
                        >
                            <option value={1}>Member</option>
                            <option value={5}>Manager</option>
                            <option value={10}>Org Owner</option>
                        </select>
                    </label>

                    <label class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Initial Quota</span>
                        <div class="mt-1 flex items-center gap-3">
                            <input 
                                type="number" 
                                name="quota"
                                value={1000000}
                                class="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-sm text-white focus:border-blue-500 outline-none transition-all"
                            />
                            <span class="text-xs text-gray-500">Credits</span>
                        </div>
                    </label>
                </div>

                <div class="flex items-center justify-end gap-3 pt-4 border-t border-white/5">
                    <button type="button" onclick={() => showingAddModal = false} class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                    <button 
                        type="submit" 
                        disabled={saving}
                        class="btn-primary py-2 px-6"
                    >
                        {saving ? 'Creating...' : 'Create Member'}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- Edit Modal -->
{#if editingMember}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div class="glass-card w-full max-w-md p-0 overflow-hidden shadow-2xl border-white/10">
            <div class="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
                <h3 class="text-lg font-bold text-white">Edit Member</h3>
                <button onclick={() => editingMember = null} class="p-1 text-gray-500 hover:text-white transition-colors">
                    <X size={20} />
                </button>
            </div>
            
            <form 
                method="POST" 
                action="?/updateMember"
                use:enhance={() => {
                    saving = true;
                    return async ({ result }) => {
                        saving = false;
                        if (result.type === 'success') editingMember = null;
                    };
                }}
                class="p-6 space-y-6"
            >
                <input type="hidden" name="id" value={editingMember.id} />
                
                <div class="space-y-4">
                    <div class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Username</span>
                        <div class="mt-1 text-sm text-white font-medium p-2 bg-white/5 rounded-md border border-white/5" role="textbox" aria-readonly="true">
                            {editingMember.username}
                        </div>
                    </div>

                    <label class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</span>
                        <select 
                            name="role" 
                            bind:value={editingMember.role}
                            class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-sm text-white focus:border-blue-500 outline-none transition-all"
                        >
                            <option value={1}>Member</option>
                            <option value={5}>Manager</option>
                            <option value={10}>Org Owner</option>
                        </select>
                    </label>

                    <label class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Quota (Bonus)</span>
                        <div class="mt-1 flex items-center gap-3">
                            <input 
                                type="number" 
                                name="quota"
                                bind:value={editingMember.quota}
                                class="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-sm text-white focus:border-blue-500 outline-none transition-all"
                            />
                            <span class="text-xs text-gray-500">Credits</span>
                        </div>
                    </label>

                    <label class="block">
                        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</span>
                        <select 
                            name="status" 
                            bind:value={editingMember.status}
                            class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-sm text-white focus:border-blue-500 outline-none transition-all"
                        >
                            <option value={1}>Active</option>
                            <option value={0}>Disabled</option>
                        </select>
                    </label>
                </div>

                <div class="flex items-center justify-end gap-3 pt-4 border-t border-white/5">
                    <button type="button" onclick={() => editingMember = null} class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                    <button 
                        type="submit" 
                        disabled={saving}
                        class="btn-primary py-2 px-6"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- Delete Modal -->
{#if deletingMember}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div class="glass-card w-full max-w-sm p-6 border-red-500/20 shadow-2xl">
            <div class="flex items-center gap-3 text-red-500 mb-4">
                <AlertTriangle size={24} />
                <h3 class="text-lg font-bold">Remove Member?</h3>
            </div>
            <p class="text-sm text-gray-400 mb-6">
                Are you sure you want to remove <span class="text-white font-medium">{deletingMember.username}</span> from the organization? They will lose access to team quotas and shared models.
            </p>
            
            <form 
                method="POST" 
                action="?/deleteMember"
                use:enhance={() => {
                    saving = true;
                    return async ({ result }) => {
                        saving = false;
                        if (result.type === 'success') deletingMember = null;
                        // Handle potential error from server
                        if (result.type === 'failure' || (result.type === 'success' && result.data?.error)) {
                             alert(result.data?.error || 'Failed to remove member');
                        }
                    };
                }}
                class="flex items-center justify-end gap-3"
            >
                <input type="hidden" name="id" value={deletingMember.id} />
                <button type="button" onclick={() => deletingMember = null} class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button 
                    type="submit" 
                    disabled={saving}
                    class="px-6 py-2 bg-red-500/10 text-red-500 border border-red-500/50 rounded-lg hover:bg-red-500 hover:text-white transition-all text-sm font-bold"
                >
                    {saving ? 'Removing...' : 'Remove Member'}
                </button>
            </form>
        </div>
    </div>
{/if}
