<script lang="ts">
    import { ChevronLeft, Terminal, Server, Clock, Cpu, Copy, Check } from 'lucide-svelte';
    import type { PortalLogDetail } from '$lib/types';
    
    type LogDetailPageData = {
        log: PortalLogDetail;
    };

    let { data }: { data: LogDetailPageData } = $props();
    let copied = $state({ req: false, res: false });

    function copyToClipboard(value: unknown, type: 'req' | 'res') {
        navigator.clipboard.writeText(JSON.stringify(value, null, 2));
        copied[type] = true;
        setTimeout(() => copied[type] = false, 2000);
    }

    let log = $derived(data.log);
</script>

<div class="space-y-6">
    <div class="flex items-center gap-4">
        <a href="/logs" class="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400">
            <ChevronLeft size={20} />
        </a>
        <h2 class="text-xl font-bold text-white">Log Details</h2>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-mono border border-gray-700 bg-gray-800 text-gray-400">
            {log.traceId || log.id}
        </span>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Metadata Sidebar -->
        <div class="space-y-6">
            <div class="glass-card p-6 space-y-4">
                <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Clock size={14} /> Metadata
                </h3>
                
                <div class="space-y-3">
                    <div class="flex justify-between">
                        <span class="text-xs text-gray-500">Timestamp</span>
                        <span class="text-xs text-white">{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-xs text-gray-500">User</span>
                        <span class="text-xs text-blue-400">{log.username}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-xs text-gray-500">Model</span>
                        <span class="text-xs text-purple-400 font-mono">{log.modelName}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-xs text-gray-500">Latency</span>
                        <span class="text-xs text-white">{log.elapsedMs ?? 0}ms</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-xs text-gray-500">Cost</span>
                        <span class="text-xs text-green-400">${log.quotaCost.toFixed(6)}</span>
                    </div>
                </div>
            </div>

            <div class="glass-card p-6 space-y-4">
                <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Cpu size={14} /> Consumption
                </h3>
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs text-gray-500">Prompt</span>
                        <span class="text-xs font-mono text-white">{log.promptTokens}</span>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-xs text-gray-500">Completion</span>
                        <span class="text-xs font-mono text-white">{log.completionTokens}</span>
                    </div>
                    <div class="w-full h-1.5 bg-gray-800 rounded-full mt-2 overflow-hidden">
                        <div class="h-full bg-blue-500" style="width: {((log.promptTokens / Math.max(log.promptTokens + log.completionTokens, 1)) * 100)}%"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Payloads -->
        <div class="lg:col-span-2 space-y-6">
            <!-- Request Body -->
            <div class="glass-card overflow-hidden">
                <div class="px-6 py-4 border-b border-[#30363d] flex items-center justify-between bg-white/[0.02]">
                    <div class="flex items-center gap-2 text-sm font-semibold text-white">
                        <Terminal size={16} class="text-blue-400" />
                        Request Payload
                    </div>
                    <button 
                        onclick={() => copyToClipboard(log.requestBody, 'req')}
                        class="p-1.5 text-gray-500 hover:text-white transition-colors"
                    >
                        {#if copied.req}<Check size={14} class="text-green-500" />{:else}<Copy size={14} />{/if}
                    </button>
                </div>
                <div class="p-6 overflow-x-auto">
                    <pre class="text-xs font-mono text-gray-300 leading-relaxed">
                            {JSON.stringify(log.requestBody, null, 2)}
                    </pre>
                </div>
            </div>

            <!-- Response Body -->
            <div class="glass-card overflow-hidden">
                <div class="px-6 py-4 border-b border-[#30363d] flex items-center justify-between bg-white/[0.02]">
                    <div class="flex items-center gap-2 text-sm font-semibold text-white">
                        <Server size={16} class="text-purple-400" />
                        Response Payload
                    </div>
                    <button 
                        onclick={() => copyToClipboard(log.responseBody, 'res')}
                        class="p-1.5 text-gray-500 hover:text-white transition-colors"
                    >
                        {#if copied.res}<Check size={14} class="text-green-500" />{:else}<Copy size={14} />{/if}
                    </button>
                </div>
                <div class="p-6 overflow-x-auto">
                    {#if log.responseBody}
                        <pre class="text-xs font-mono text-gray-300 leading-relaxed">
                            {JSON.stringify(log.responseBody, null, 2)}
                        </pre>
                    {:else}
                        <p class="text-xs italic text-gray-600">No response payload recorded (streaming or large payload).</p>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>
