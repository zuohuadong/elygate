<script lang="ts">
    import { BookOpen, Copy, Check, Zap, Code, MessageSquare, Image, Mic, FileText } from "lucide-svelte";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";

    let copied = $state<string | null>(null);
    let activeTab = $state<'chat' | 'embeddings' | 'images' | 'audio' | 'errors'>('chat');

    function copyCode(code: string, id: string) {
        const hasClipboard = typeof navigator !== 'undefined' && 
                           !!navigator.clipboard && 
                           typeof navigator.clipboard.writeText === 'function';

        if (hasClipboard) {
            navigator.clipboard.writeText(code).then(() => {
                copied = id;
                setTimeout(() => (copied = null), 2000);
            }).catch(err => {
                console.error("Copy failed:", err);
            });
        }
    }

    let apiHost = $state('http://localhost:3000');

    onMount(() => {
        apiHost = window.location.origin;
    });

    function getChatCode(): string {
        return `curl ${apiHost}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-token" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'`;
    }

    function getEmbeddingsCode(): string {
        return `curl ${apiHost}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-token" \\
  -d '{
    "model": "text-embedding-3-small",
    "input": "Hello world"
  }'`;
    }

    function getImagesCode(): string {
        return `curl ${apiHost}/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-token" \\
  -d '{
    "model": "dall-e-3",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024"
  }'`;
    }

    function getAudioCode(): string {
        return `curl ${apiHost}/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-token" \\
  -d '{
    "model": "tts-1",
    "input": "Hello world",
    "voice": "alloy"
  }'`;
    }

    function getPythonCode(): string {
        return `from openai import OpenAI

client = OpenAI(
    base_url="${apiHost}/v1",
    api_key="sk-your-token"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`;
    }

    function getNodeCode(): string {
        return `import OpenAI from 'openai';

const client = new OpenAI({
    baseURL: '${apiHost}/v1',
    apiKey: 'sk-your-token'
});

const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.choices[0].message.content);`;
    }
</script>

<div class="flex-1 space-y-6 max-w-5xl mx-auto p-4 md:p-0">
    <div>
        <h2 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen class="w-6 h-6 text-indigo-500" />
            {i18n.lang === "zh" ? "API 接入文档" : "API Documentation"}
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {i18n.lang === "zh"
                ? "遵循 OpenAI 接口规范，一键接入海量大模型。"
                : "Follows OpenAI standards. Easily integrate with numerous foundation models."}
        </p>
    </div>

    <!-- Quick Start -->
    <div class="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl shadow-lg overflow-hidden">
        <div class="p-6">
            <h3 class="text-lg font-semibold text-white flex items-center gap-2">
                <Zap class="w-5 h-5" />
                {i18n.lang === "zh" ? "快速开始" : "Quick Start"}
            </h3>
            <p class="text-sm text-indigo-100 mt-2">
                {i18n.lang === "zh"
                    ? "只需三步，即可开始使用 API"
                    : "Get started in three simple steps"}
            </p>
        </div>
        <div class="px-6 pb-6 space-y-3">
            <div class="flex items-start gap-3 bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold">1</div>
                <div>
                    <p class="text-sm font-medium text-white">{i18n.lang === "zh" ? "获取 API Key" : "Get your API Key"}</p>
                    <p class="text-xs text-indigo-100 mt-1">{i18n.lang === "zh" ? "在令牌管理页面创建您的 API Key" : "Create your API Key in the Tokens page"}</p>
                </div>
            </div>
            <div class="flex items-start gap-3 bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold">2</div>
                <div>
                    <p class="text-sm font-medium text-white">{i18n.lang === "zh" ? "设置 Base URL" : "Set Base URL"}</p>
                    <p class="text-xs text-indigo-100 mt-1 font-mono">{apiHost}/v1</p>
                </div>
            </div>
            <div class="flex items-start gap-3 bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold">3</div>
                <div>
                    <p class="text-sm font-medium text-white">{i18n.lang === "zh" ? "开始调用" : "Start calling"}</p>
                    <p class="text-xs text-indigo-100 mt-1">{i18n.lang === "zh" ? "使用任意 OpenAI 兼容的 SDK" : "Use any OpenAI-compatible SDK"}</p>
                </div>
            </div>
        </div>
    </div>

    <!-- API Endpoints -->
    <div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div class="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                {i18n.lang === "zh" ? "API 端点" : "API Endpoints"}
            </h3>
        </div>
        <div class="p-6 space-y-4">
            <div>
                <p class="text-sm text-slate-600 dark:text-slate-400">
                    {i18n.lang === "zh" ? "基础 URL (Base URL):" : "Base URL:"}
                </p>
                <code class="block mt-2 px-4 py-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-mono">
                    {apiHost}/v1
                </code>
            </div>
            <div>
                <p class="text-sm text-slate-600 dark:text-slate-400">
                    {i18n.lang === "zh" ? "认证方式 (Authentication):" : "Authentication:"}
                </p>
                <code class="block mt-2 px-4 py-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-mono">
                    Authorization: Bearer sk-your-token
                </code>
            </div>
        </div>
    </div>

    <!-- Tab Navigation -->
    <div class="flex gap-2 overflow-x-auto pb-2">
        <button
            onclick={() => activeTab = 'chat'}
            class="px-4 py-2 text-sm font-medium rounded-lg transition-colors {activeTab === 'chat' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}"
        >
            <MessageSquare class="w-4 h-4 inline mr-2" />
            Chat
        </button>
        <button
            onclick={() => activeTab = 'embeddings'}
            class="px-4 py-2 text-sm font-medium rounded-lg transition-colors {activeTab === 'embeddings' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}"
        >
            <Code class="w-4 h-4 inline mr-2" />
            Embeddings
        </button>
        <button
            onclick={() => activeTab = 'images'}
            class="px-4 py-2 text-sm font-medium rounded-lg transition-colors {activeTab === 'images' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}"
        >
            <Image class="w-4 h-4 inline mr-2" />
            Images
        </button>
        <button
            onclick={() => activeTab = 'audio'}
            class="px-4 py-2 text-sm font-medium rounded-lg transition-colors {activeTab === 'audio' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}"
        >
            <Mic class="w-4 h-4 inline mr-2" />
            Audio
        </button>
        <button
            onclick={() => activeTab = 'errors'}
            class="px-4 py-2 text-sm font-medium rounded-lg transition-colors {activeTab === 'errors' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}"
        >
            <FileText class="w-4 h-4 inline mr-2" />
            Errors
        </button>
    </div>

    <!-- Chat Completions -->
    {#if activeTab === 'chat'}
        <div class="bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-800">
            <div class="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 class="font-semibold text-white text-sm">POST /v1/chat/completions</h3>
                <button
                    class="text-slate-400 hover:text-white transition-colors"
                    onclick={() => copyCode(getChatCode(), 'chat')}
                >
                    {#if copied === 'chat'}
                        <Check class="w-4 h-4 text-emerald-400" />
                    {:else}
                        <Copy class="w-4 h-4" />
                    {/if}
                </button>
            </div>
            <div class="p-4 overflow-x-auto">
                <pre class="text-sm font-mono text-emerald-400 whitespace-pre-wrap">{getChatCode()}</pre>
            </div>
        </div>

        <div class="mt-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <h4 class="font-semibold text-slate-900 dark:text-white text-sm mb-3">{i18n.lang === "zh" ? "请求参数" : "Request Parameters"}</h4>
            <div class="space-y-2 text-sm">
                <div class="flex gap-2"><code class="text-indigo-500 font-mono">model</code><span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "(必需) 模型名称" : "(required) Model name"}</span></div>
                <div class="flex gap-2"><code class="text-indigo-500 font-mono">messages</code><span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "(必需) 消息数组" : "(required) Message array"}</span></div>
                <div class="flex gap-2"><code class="text-indigo-500 font-mono">stream</code><span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "(可选) 是否流式返回" : "(optional) Enable streaming"}</span></div>
                <div class="flex gap-2"><code class="text-indigo-500 font-mono">temperature</code><span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "(可选) 温度参数 0-2" : "(optional) Temperature 0-2"}</span></div>
                <div class="flex gap-2"><code class="text-indigo-500 font-mono">max_tokens</code><span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "(可选) 最大 token 数" : "(optional) Max tokens"}</span></div>
            </div>
        </div>
    {/if}

    <!-- Embeddings -->
    {#if activeTab === 'embeddings'}
        <div class="bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-800">
            <div class="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 class="font-semibold text-white text-sm">POST /v1/embeddings</h3>
                <button
                    class="text-slate-400 hover:text-white transition-colors"
                    onclick={() => copyCode(getEmbeddingsCode(), 'embeddings')}
                >
                    {#if copied === 'embeddings'}
                        <Check class="w-4 h-4 text-emerald-400" />
                    {:else}
                        <Copy class="w-4 h-4" />
                    {/if}
                </button>
            </div>
            <div class="p-4 overflow-x-auto">
                <pre class="text-sm font-mono text-emerald-400 whitespace-pre-wrap">{getEmbeddingsCode()}</pre>
            </div>
        </div>
    {/if}

    <!-- Images -->
    {#if activeTab === 'images'}
        <div class="bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-800">
            <div class="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 class="font-semibold text-white text-sm">POST /v1/images/generations</h3>
                <button
                    class="text-slate-400 hover:text-white transition-colors"
                    onclick={() => copyCode(getImagesCode(), 'images')}
                >
                    {#if copied === 'images'}
                        <Check class="w-4 h-4 text-emerald-400" />
                    {:else}
                        <Copy class="w-4 h-4" />
                    {/if}
                </button>
            </div>
            <div class="p-4 overflow-x-auto">
                <pre class="text-sm font-mono text-emerald-400 whitespace-pre-wrap">{getImagesCode()}</pre>
            </div>
        </div>
    {/if}

    <!-- Audio -->
    {#if activeTab === 'audio'}
        <div class="bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-800">
            <div class="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 class="font-semibold text-white text-sm">POST /v1/audio/speech</h3>
                <button
                    class="text-slate-400 hover:text-white transition-colors"
                    onclick={() => copyCode(getAudioCode(), 'audio')}
                >
                    {#if copied === 'audio'}
                        <Check class="w-4 h-4 text-emerald-400" />
                    {:else}
                        <Copy class="w-4 h-4" />
                    {/if}
                </button>
            </div>
            <div class="p-4 overflow-x-auto">
                <pre class="text-sm font-mono text-emerald-400 whitespace-pre-wrap">{getAudioCode()}</pre>
            </div>
        </div>
    {/if}

    <!-- Errors -->
    {#if activeTab === 'errors'}
        <div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
            <h4 class="font-semibold text-slate-900 dark:text-white text-sm mb-4">{i18n.lang === "zh" ? "错误响应格式" : "Error Response Format"}</h4>
            <pre class="text-sm font-mono text-slate-200 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 rounded-xl p-4 overflow-x-auto">&#123;
  "success": false,
  "message": "Error description here"
&#125;</pre>

            <h4 class="font-semibold text-slate-900 dark:text-white text-sm mb-4 mt-6">{i18n.lang === "zh" ? "常见错误码" : "Common Error Codes"}</h4>
            <div class="space-y-2 text-sm">
                <div class="flex gap-3">
                    <code class="text-red-500 font-mono">401</code>
                    <span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "认证失败，API Key 无效" : "Authentication failed, invalid API Key"}</span>
                </div>
                <div class="flex gap-3">
                    <code class="text-red-500 font-mono">403</code>
                    <span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "权限不足或配额已用尽" : "Insufficient permissions or quota exhausted"}</span>
                </div>
                <div class="flex gap-3">
                    <code class="text-red-500 font-mono">404</code>
                    <span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "模型不存在或无可用渠道" : "Model not found or no available channel"}</span>
                </div>
                <div class="flex gap-3">
                    <code class="text-red-500 font-mono">429</code>
                    <span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "请求过于频繁，请稍后重试" : "Rate limit exceeded, please retry later"}</span>
                </div>
                <div class="flex gap-3">
                    <code class="text-red-500 font-mono">500</code>
                    <span class="text-slate-600 dark:text-slate-300">{i18n.lang === "zh" ? "服务器内部错误" : "Internal server error"}</span>
                </div>
            </div>
        </div>
    {/if}

    <!-- SDK Examples -->
    <div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div class="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Code class="w-5 h-5 text-indigo-500" />
                {i18n.lang === "zh" ? "SDK 示例" : "SDK Examples"}
            </h3>
        </div>
        <div class="p-6 space-y-4">
            <div>
                <p class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Python (OpenAI SDK)</p>
                <pre class="text-xs font-mono text-slate-200 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">{getPythonCode()}</pre>
            </div>
            <div>
                <p class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Node.js (OpenAI SDK)</p>
                <pre class="text-xs font-mono text-slate-200 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">{getNodeCode()}</pre>
            </div>
        </div>
    </div>

    <!-- Best Practices -->
    <div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-900 rounded-2xl p-6">
        <h3 class="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2 mb-4">
            <Zap class="w-5 h-5" />
            {i18n.lang === "zh" ? "最佳实践" : "Best Practices"}
        </h3>
        <ul class="space-y-2 text-sm text-amber-800 dark:text-amber-300">
            <li class="flex items-start gap-2">
                <Check class="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{i18n.lang === "zh" ? "始终在环境变量中存储 API Key，不要硬编码" : "Always store API Key in environment variables, never hardcode"}</span>
            </li>
            <li class="flex items-start gap-2">
                <Check class="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{i18n.lang === "zh" ? "实现指数退避重试机制处理速率限制" : "Implement exponential backoff for rate limit handling"}</span>
            </li>
            <li class="flex items-start gap-2">
                <Check class="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{i18n.lang === "zh" ? "使用流式响应改善用户体验" : "Use streaming for better user experience"}</span>
            </li>
            <li class="flex items-start gap-2">
                <Check class="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{i18n.lang === "zh" ? "监控配额使用情况，避免超额" : "Monitor quota usage to avoid overages"}</span>
            </li>
            <li class="flex items-start gap-2">
                <Check class="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{i18n.lang === "zh" ? "为生产环境设置合理的超时时间" : "Set appropriate timeouts for production"}</span>
            </li>
        </ul>
    </div>
</div>
