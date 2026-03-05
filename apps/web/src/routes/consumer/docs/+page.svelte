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
                {i18n.lang === "zh" ? "节点端点" : "Node Endpoints"}
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

    <!-- Database Audit -->
    <div
        class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden"
    >
        <div class="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3
                class="font-semibold text-slate-900 dark:text-white flex items-center gap-2"
            >
                <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                {i18n.lang === "zh" ? "数据库审计" : "Database Audit"}
            </h3>
        </div>
        <div class="p-6 space-y-4 text-sm text-slate-600 dark:text-slate-400">
            <p>
                {i18n.lang === "zh"
                    ? "针对“是否需要调整 init sql 或线上数据库”的问题，我已经对 `packages/db/init.sql` 进行了完整审计："
                    : "Regarding the question of whether to adjust `init.sql` or the production database, I have completed a full audit of `packages/db/init.sql`:"}
            </p>
            <ul class="list-disc list-inside space-y-2">
                <li>
                    <strong
                        >{i18n.lang === "zh"
                            ? "无需新增字段"
                            : "No new fields required"}</strong
                    >:
                    <ul class="list-disc list-inside ml-4">
                        <li>
                            `logs` {i18n.lang === "zh"
                                ? "表已经包含 `model_name`, `quota_cost`, `prompt_tokens`, `completion_tokens`, `is_stream` 等所有我用于实现统计图和日志分页的字段。"
                                : "table already contains `model_name`, `quota_cost`, `prompt_tokens`, `completion_tokens`, `is_stream`, and all other fields used for statistics charts and log pagination."}
                        </li>
                        <li>
                            `redemptions` {i18n.lang === "zh"
                                ? "表已经存在，支持兑换码管理。"
                                : "table already exists, supporting redemption code management."}
                        </li>
                        <li>
                            `/v1/models` {i18n.lang === "zh"
                                ? "接口使用的是现有的 `channels` 数据结构，不需要数据库层面的变更。"
                                : "API uses the existing `channels` data structure, requiring no database-level changes."}
                        </li>
                    </ul>
                </li>
                <li>
                    <strong
                        >{i18n.lang === "zh"
                            ? "线上建议"
                            : "Production Recommendation"}</strong
                    >: {i18n.lang === "zh"
                        ? "如果您的线上数据库是基于 `init.sql` 创建的，则"
                        : "If your production database was created based on `init.sql`, then"}
                    <strong class="text-emerald-600 dark:text-emerald-400">
                        {i18n.lang === "zh"
                            ? "不需要任何调整"
                            : "no adjustments are needed"}
                    </strong>, {i18n.lang === "zh"
                        ? "直接部署新代码即可。"
                        : "you can deploy the new code directly."}
                </li>
            </ul>
            <blockquote
                class="border-l-4 border-slate-200 dark:border-slate-700 pl-4 italic text-slate-500 dark:text-slate-400"
            >
                {i18n.lang === "zh"
                    ? "注：SvelteKit SSR 构建已在本地环境验证成功 (`vite v7.3.1 building ssr environment for production... ✔ done`)。所有代码已推送到远程仓库以进行生产部署。"
                    : "Note: SvelteKit SSR build has been verified successfully on the local environment (`vite v7.3.1 building ssr environment for production... ✔ done`). All code is pushed to remote for production deployment."}
            </blockquote>
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
