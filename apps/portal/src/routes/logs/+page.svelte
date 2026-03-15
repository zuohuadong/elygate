<script lang="ts">
    import { Search, Filter, FileJson, Clock, ChevronLeft, ChevronRight } from 'lucide-svelte';
    import type { PortalLogSummary } from '$lib/types';

    type LogsPageData = {
        logs: PortalLogSummary[];
        currentPage: number;
    };
    
    let { data }: { data: LogsPageData } = $props();

    const getStatusColor = (code: number) => {
        if (code >= 200 && code < 300) return 'text-green-400 bg-green-400/10 border-green-400/20';
        if (code >= 400 && code < 500) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
        return 'text-red-400 bg-red-400/10 border-red-400/20';
    };

    function formatTokens(tokens: number) {
        if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'k';
        return tokens;
    }
</script>

<div class="space-y-6">
    <!-- Header/Filter Bar -->
    <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex-1 min-w-[300px] relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input 
                type="text" 
                placeholder="Search by Trace ID, User, or Model..."
                class="w-full bg-[#161b22] border border-[#30363d] rounded-lg py-2 pl-10 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm outline-none"
            />
        </div>
        <div class="flex items-center gap-2">
            <a 
                href="/logs/export" 
                download
                class="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400 hover:bg-blue-500/20 transition-all"
            >
                <FileJson size={16} />
                Export CSV
            </a>
            <button class="flex items-center gap-2 px-3 py-2 bg-white/5 border border-[#30363d] rounded-lg text-sm hover:bg-white/10 transition-all">
                <Clock size={16} />
                Last 24 Hours
            </button>
            <button class="flex items-center gap-2 px-3 py-2 bg-white/5 border border-[#30363d] rounded-lg text-sm hover:bg-white/10 transition-all">
                <Filter size={16} />
                Status
            </button>
        </div>
    </div>

    <!-- Logs Table -->
    <div class="glass-card overflow-hidden">
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="border-b border-[#30363d] bg-white/[0.02]">
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Timestamp</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">User / Model</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tokens</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Cost</th>
                    <th class="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Details</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-[#30363d]">
                {#each data.logs as log}
                    <tr class="hover:bg-white/[0.02] transition-colors group">
                        <td class="px-6 py-4">
                            <div class="flex flex-col">
                                <span class="text-sm text-white font-mono">{new Date(log.createdAt).toLocaleTimeString()}</span>
                                <span class="text-[10px] text-gray-500">{new Date(log.createdAt).toLocaleDateString()}</span>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-white">{log.username}</span>
                                <span class="text-xs text-gray-400 flex items-center gap-1">
                                    <div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                    {log.modelName}
                                </span>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border {getStatusColor(log.statusCode)}">
                                {log.statusCode}
                            </span>
                        </td>
                        <td class="px-6 py-4">
                            <div class="text-xs text-gray-300 font-mono">
                                <span>{formatTokens(log.promptTokens)}</span>
                                <span class="text-gray-600 mx-1">+</span>
                                <span>{formatTokens(log.completionTokens)}</span>
                            </div>
                        </td>
                        <td class="px-6 py-4 font-mono text-sm text-gray-400">
                            ${log.quotaCost.toFixed(4)}
                        </td>
                        <td class="px-6 py-4 text-right">
                            {#if log.hasDetails}
                                <a 
                                    href="/logs/{log.id}"
                                    class="p-1.5 inline-flex items-center gap-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-md hover:bg-blue-500/20 transition-all text-xs"
                                >
                                    <FileJson size={14} />
                                    Inspect
                                </a>
                            {:else}
                                <span class="text-xs text-gray-600 italic">No payload</span>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>

        <!-- Pagination -->
        <div class="px-6 py-4 border-t border-[#30363d] flex items-center justify-between bg-white/[0.01]">
            <p class="text-xs text-gray-500">Showing {data.logs.length} logs on this page</p>
            <div class="flex items-center gap-2">
                <button class="p-1.5 border border-[#30363d] rounded-md hover:bg-white/5 disabled:opacity-30" disabled={data.currentPage === 1}>
                    <ChevronLeft size={16} />
                </button>
                <span class="text-xs font-medium text-white px-2">Page {data.currentPage}</span>
                <button class="p-1.5 border border-[#30363d] rounded-md hover:bg-white/5">
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    </div>
</div>
