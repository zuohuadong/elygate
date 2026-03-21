<script lang="ts">
    import { Key, User, Calendar, ShieldAlert, Trash2, ExternalLink } from 'lucide-svelte';
    import { enhance } from '$app/forms';
    import { fade } from 'svelte/transition';

    let { data }: { data: { tokens: Record<string, any>[] } } = $props();

    let revokingId = $state<string | null>(null);
</script>

<div class="space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-xl font-bold text-white">Organization API Keys</h2>
            <p class="text-sm text-gray-500">Monitor and manage all API keys created by members of your organization.</p>
        </div>
    </div>

    <div class="glass-card overflow-hidden">
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="border-b border-[#30363d] bg-white/[0.02]">
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Key Name / Prefix</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Owner</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Last Used</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-[#30363d]">
                {#each data.tokens as token}
                    <tr class="hover:bg-white/[0.01] transition-colors group">
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-3">
                                <div class="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                                    <Key size={16} />
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-sm font-medium text-white">{token.name || 'Untitled Key'}</span>
                                    <span class="text-[10px] font-mono text-gray-500">{token.tokenPreview}</span>
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-2">
                                <div class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-300">
                                    {token.ownerName[0].toUpperCase()}
                                </div>
                                <div class="flex flex-col">
                                    <span class="text-xs text-white">{token.ownerName}</span>
                                    <span class="text-[10px] text-gray-500">{token.ownerRole === 10 ? 'Admin' : 'Member'}</span>
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-2 text-xs text-gray-400">
                                <Calendar size={12} />
                                {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : 'Never used'}
                            </div>
                        </td>
                        <td class="px-6 py-4 text-right">
                            <form 
                                method="POST" 
                                action="?/revokeToken" 
                                use:enhance={() => {
                                    revokingId = token.id;
                                    return async ({ update }) => {
                                        await update();
                                        revokingId = null;
                                    };
                                }}
                            >
                                <input type="hidden" name="tokenId" value={token.id} />
                                <button 
                                    type="submit"
                                    class="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all disabled:opacity-50"
                                    disabled={revokingId === token.id}
                                    title="Revoke Key"
                                >
                                    {#if revokingId === token.id}
                                        <div class="w-4 h-4 border-2 border-red-400 border-t-transparent animate-spin rounded-full"></div>
                                    {:else}
                                        <Trash2 size={16} />
                                    {/if}
                                </button>
                            </form>
                        </td>
                    </tr>
                {:else}
                    <tr>
                        <td colspan="4" class="px-6 py-12 text-center text-gray-500 italic text-sm">
                            No API keys found for this organization.
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    <!-- Security Note -->
    <div class="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg flex gap-3">
        <ShieldAlert size={18} class="text-yellow-500 shrink-0" />
        <p class="text-xs text-yellow-500/80 leading-relaxed">
            <strong>Security Advisory:</strong> Revoking a key is permanent and will immediately disconnect any applications using it. 
            Only the hash is stored; original keys cannot be recovered.
        </p>
    </div>
</div>
