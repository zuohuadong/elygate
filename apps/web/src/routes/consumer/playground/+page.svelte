<script lang="ts">
    import { Play, Copy, Check, Trash2, Loader2, ChevronDown, Code, MessageSquare } from "lucide-svelte";
    import { apiFetch } from "$lib/api";
    import { i18n } from "$lib/i18n/index.svelte";
    import { session } from "$lib/session.svelte";
    import { onMount } from "svelte";

    interface Model {
        id: string;
        name: string;
    }

    let models = $state<Model[]>([]);
    let selectedModel = $state("");
    let messages = $state<{ role: string; content: string }[]>([
        { role: "user", content: "" }
    ]);
    let response = $state("");
    let rawResponse = $state<any>(null);
    let isLoading = $state(false);
    let copied = $state(false);
    let showRaw = $state(false);
    let temperature = $state(0.7);
    let maxTokens = $state(1024);
    let error = $state("");

    onMount(async () => {
        try {
            const data = await apiFetch<{ data: Model[] }>("/v1/models");
            models = data.data || [];
            if (models.length > 0) {
                selectedModel = models[0].id;
            }
        } catch (e) {
            console.error("Failed to load models:", e);
        }
    });

    function addMessage() {
        messages = [...messages, { role: "user", content: "" }];
    }

    function removeMessage(index: number) {
        messages = messages.filter((_, i) => i !== index);
    }

    function updateMessage(index: number, content: string) {
        messages = messages.map((m, i) => (i === index ? { ...m, content } : m));
    }

    function updateRole(index: number, role: string) {
        messages = messages.map((m, i) => (i === index ? { ...m, role } : m));
    }

    async function sendRequest() {
        if (!selectedModel || messages.every(m => !m.content.trim())) {
            error = i18n.lang === "zh" ? "请选择模型并输入消息" : "Please select a model and enter a message";
            return;
        }

        isLoading = true;
        error = "";
        response = "";
        rawResponse = null;

        try {
            const res = await fetch("/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.token}`
                },
                body: JSON.stringify({
                    model: selectedModel,
                    messages: messages.filter(m => m.content.trim()),
                    temperature,
                    max_tokens: maxTokens,
                    stream: false
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error?.message || "Request failed");
            }

            const data = await res.json();
            rawResponse = data;
            response = data.choices?.[0]?.message?.content || "";
        } catch (e: any) {
            error = e.message;
        } finally {
            isLoading = false;
        }
    }

    function copyResponse() {
        navigator.clipboard.writeText(response);
        copied = true;
        setTimeout(() => (copied = false), 2000);
    }

    function clearAll() {
        messages = [{ role: "user", content: "" }];
        response = "";
        rawResponse = null;
        error = "";
    }
</script>

<div class="flex-1 space-y-6 max-w-6xl mx-auto w-full">
    <!-- Header -->
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <Play class="w-6 h-6 text-indigo-500" />
                {i18n.lang === "zh" ? "API 测试" : "Playground"}
            </h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {i18n.lang === "zh" ? "测试 API 请求，查看响应结果" : "Test API requests and view responses"}
            </p>
        </div>
        <button
            onclick={clearAll}
            class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg transition"
        >
            <Trash2 class="w-4 h-4" />
            {i18n.lang === "zh" ? "清空" : "Clear"}
        </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Input Panel -->
        <div class="space-y-4">
            <!-- Model Selection -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {i18n.lang === "zh" ? "选择模型" : "Select Model"}
                </label>
                <div class="relative">
                    <select
                        bind:value={selectedModel}
                        class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        {#each models as model}
                            <option value={model.id}>{model.id}</option>
                        {/each}
                    </select>
                    <ChevronDown class="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
            </div>

            <!-- Parameters -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                    {i18n.lang === "zh" ? "参数设置" : "Parameters"}
                </h3>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs text-slate-500 mb-1">Temperature</label>
                        <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            bind:value={temperature}
                            class="w-full"
                        />
                        <div class="text-xs text-slate-400 text-right">{temperature}</div>
                    </div>
                    <div>
                        <label class="block text-xs text-slate-500 mb-1">Max Tokens</label>
                        <input
                            type="number"
                            bind:value={maxTokens}
                            min="1"
                            max="32000"
                            class="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                        />
                    </div>
                </div>
            </div>

            <!-- Messages -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <MessageSquare class="w-4 h-4" />
                        {i18n.lang === "zh" ? "消息" : "Messages"}
                    </h3>
                    <button
                        onclick={addMessage}
                        class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        + {i18n.lang === "zh" ? "添加消息" : "Add Message"}
                    </button>
                </div>
                <div class="space-y-3">
                    {#each messages as message, index}
                        <div class="flex gap-2 items-start">
                            <select
                                value={message.role}
                                onchange={(e) => updateRole(index, e.currentTarget.value)}
                                class="px-2 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                            >
                                <option value="system">system</option>
                                <option value="user">user</option>
                                <option value="assistant">assistant</option>
                            </select>
                            <textarea
                                value={message.content}
                                oninput={(e) => updateMessage(index, e.currentTarget.value)}
                                placeholder={i18n.lang === "zh" ? "输入消息内容..." : "Enter message..."}
                                rows="2"
                                class="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            ></textarea>
                            {#if messages.length > 1}
                                <button
                                    onclick={() => removeMessage(index)}
                                    class="p-2 text-slate-400 hover:text-red-500 transition"
                                >
                                    <Trash2 class="w-4 h-4" />
                                </button>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>

            <!-- Send Button -->
            <button
                onclick={sendRequest}
                disabled={isLoading || !selectedModel}
                class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white font-medium rounded-xl transition"
            >
                {#if isLoading}
                    <Loader2 class="w-4 h-4 animate-spin" />
                    {i18n.lang === "zh" ? "请求中..." : "Loading..."}
                {:else}
                    <Play class="w-4 h-4" />
                    {i18n.lang === "zh" ? "发送请求" : "Send Request"}
                {/if}
            </button>
        </div>

        <!-- Output Panel -->
        <div class="space-y-4">
            <!-- Error -->
            {#if error}
                <div class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl p-4">
                    <p class="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
            {/if}

            <!-- Response -->
            <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                <div class="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
                    <h3 class="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Code class="w-4 h-4" />
                        {i18n.lang === "zh" ? "响应" : "Response"}
                    </h3>
                    <div class="flex items-center gap-2">
                        <button
                            onclick={() => (showRaw = !showRaw)}
                            class="text-xs px-3 py-1 rounded-lg {showRaw ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}"
                        >
                            {showRaw ? "Raw" : "Formatted"}
                        </button>
                        {#if response}
                            <button
                                onclick={copyResponse}
                                class="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                            >
                                {#if copied}
                                    <Check class="w-4 h-4 text-emerald-500" />
                                {:else}
                                    <Copy class="w-4 h-4 text-slate-400" />
                                {/if}
                            </button>
                        {/if}
                    </div>
                </div>
                <div class="p-4 min-h-[300px] max-h-[500px] overflow-auto">
                    {#if isLoading}
                        <div class="flex items-center justify-center h-full">
                            <Loader2 class="w-6 h-6 animate-spin text-indigo-500" />
                        </div>
                    {:else if showRaw && rawResponse}
                        <pre class="text-xs text-slate-200 dark:text-slate-200 whitespace-pre-wrap">{JSON.stringify(rawResponse, null, 2)}</pre>
                    {:else if response}
                        <div class="prose prose-sm dark:prose-invert max-w-none">
                            {response}
                        </div>
                    {:else}
                        <div class="flex items-center justify-center h-full text-slate-400 text-sm">
                            {i18n.lang === "zh" ? "发送请求后查看响应" : "Send a request to see the response"}
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Usage Info -->
            {#if rawResponse?.usage}
                <div class="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4">
                    <h4 class="text-xs font-medium text-slate-500 mb-2">
                        {i18n.lang === "zh" ? "使用统计" : "Usage"}
                    </h4>
                    <div class="grid grid-cols-3 gap-4 text-center">
                        <div>
                            <div class="text-lg font-bold text-slate-900 dark:text-white">
                                {rawResponse.usage.prompt_tokens}
                            </div>
                            <div class="text-xs text-slate-500">Prompt</div>
                        </div>
                        <div>
                            <div class="text-lg font-bold text-slate-900 dark:text-white">
                                {rawResponse.usage.completion_tokens}
                            </div>
                            <div class="text-xs text-slate-500">Completion</div>
                        </div>
                        <div>
                            <div class="text-lg font-bold text-slate-900 dark:text-white">
                                {rawResponse.usage.total_tokens}
                            </div>
                            <div class="text-xs text-slate-500">Total</div>
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
