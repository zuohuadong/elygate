<script lang="ts">
    import { BookOpen, Copy, Check } from "lucide-svelte";
    import { i18n } from "$lib/i18n/index.svelte";
    import { onMount } from "svelte";

    let copied = $state(false);

    function copyCode(code: string) {
        navigator.clipboard.writeText(code);
        copied = true;
        setTimeout(() => (copied = false), 2000);
    }
</script>

<div class="flex-1 space-y-6 max-w-4xl mx-auto p-4 md:p-0">
    <div>
        <h2
            class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"
        >
            <BookOpen class="w-6 h-6 text-indigo-500" />
            {i18n.lang === "zh" ? "API 接入文档" : "API Documentation"}
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {i18n.lang === "zh"
                ? "遵循 OpenAI 接口规范，一键接入海量大模型。"
                : "Follows OpenAI standards. Easily integrate with numerous foundation models."}
        </p>
    </div>

    <!-- API Host Info -->
    <div
        class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
    >
        <div class="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3
                class="font-semibold text-slate-900 dark:text-white flex items-center gap-2"
            >
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                Node Endpoints
            </h3>
        </div>
        <div class="p-6 space-y-4">
            <div>
                <div
                    class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                    Base URL
                </div>
                <div class="relative">
                    <code
                        class="block w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-mono text-slate-800 dark:text-slate-200"
                    >
                        https://api.elygate.com/v1
                    </code>
                </div>
            </div>

            <div class="pt-4">
                <p class="text-sm text-slate-600 dark:text-slate-400">
                    {i18n.lang === "zh"
                        ? "认证方式 (Authentication):"
                        : "Authentication:"}
                    <br />
                    {i18n.lang === "zh"
                        ? "所有 API 请求必须在 Header 中包含您的 API Key。"
                        : "All requests must include your API Key in the Authorization headers."}
                </p>
                <code
                    class="block mt-2 px-4 py-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-mono text-indigo-600 dark:text-indigo-400"
                >
                    Authorization: Bearer sk-...
                </code>
            </div>
        </div>
    </div>

    <!-- cURL Example -->
    <div
        class="bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-800"
    >
        <div
            class="p-4 border-b border-slate-800 flex items-center justify-between"
        >
            <h3 class="font-semibold text-white text-sm">
                {i18n.lang === "zh" ? "cURL 请求示例" : "cURL Example"} (Chat Completions)
            </h3>
            <button
                class="text-slate-400 hover:text-white transition-colors"
                onclick={() =>
                    copyCode(`curl https://api.elygate.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-token" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'`)}
            >
                {#if copied}
                    <Check class="w-4 h-4 text-emerald-400" />
                {:else}
                    <Copy class="w-4 h-4" />
                {/if}
            </button>
        </div>
        <div class="p-6 overflow-x-auto">
            <pre class="text-sm font-mono text-emerald-400"><code
                    >curl https://api.elygate.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <span class="text-rose-400">sk-your-token</span>" \
  -d '&lbrace;
    "model": "<span class="text-blue-400">gpt-4o</span>",
    "messages": [
      &lbrace;
        "role": "user",
        "content": "Hello!"
      &rbrace;
    ]
  &rbrace;'</code
                ></pre>
        </div>
    </div>
</div>
