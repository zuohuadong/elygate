<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, PageHeader } from '@svadmin/ui';

  interface ChatMessage {
    role: string;
    content: string;
  }

  interface UsageInfo {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }

  interface Model {
    id: string;
    name: string;
  }

  let models = $state<Model[]>([]);
  let selectedModel = $state('');
  let messages = $state<ChatMessage[]>([{ role: 'user', content: '' }]);
  let response = $state('');
  let rawResponse = $state<Record<string, unknown> | null>(null);
  let usage = $state<UsageInfo | null>(null);
  let loading = $state(false);
  let showRaw = $state(false);
  let temperature = $state(0.7);
  let maxTokens = $state(1024);
  let error = $state('');
  let copied = $state(false);

  // Get user's token from cookie-based session
  let userToken = $state('');

  onMount(async () => {
    try {
      // Load models
      const res = await fetch('/api/v1/models', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        models = data.data || [];
        if (models.length > 0) selectedModel = models[0].id;
      }
      // Load user token for API calls
      const tokenRes = await fetch('/api/auth/user/tokens', { credentials: 'include' });
      if (tokenRes.ok) {
        const tokens = await tokenRes.json();
        const arr = Array.isArray(tokens) ? tokens : tokens.data || [];
        if (arr.length > 0) userToken = arr[0].key;
      }
    } catch (e) {
      console.error('Failed to load models', e);
    }
  });

  function addMessage() {
    messages = [...messages, { role: 'user', content: '' }];
  }

  function removeMessage(i: number) {
    messages = messages.filter((_, idx) => idx !== i);
  }

  async function sendRequest() {
    if (!selectedModel || messages.every(m => !m.content.trim())) {
      error = '请选择模型并输入消息';
      return;
    }
    loading = true;
    error = '';
    response = '';
    rawResponse = null;
    usage = null;

    try {
      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: messages.filter(m => m.content.trim()),
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || `Request failed (${res.status})`);
      }
      const data = await res.json();
      rawResponse = data;
      response = data.choices?.[0]?.message?.content || '';
      usage = data.usage || null;
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function copyResponse() {
    navigator.clipboard.writeText(response);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function clearAll() {
    messages = [{ role: 'user', content: '' }];
    response = '';
    rawResponse = null;
    usage = null;
    error = '';
  }
</script>

<div class="space-y-6">
  <PageHeader title="API 测试台" description="在线测试 Chat Completions 接口">
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={clearAll}>清空</Button>
    {/snippet}
  </PageHeader>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Input Panel -->
    <div class="space-y-4">
      <!-- Model & Params -->
      <Card.Root>
        <Card.Content class="pt-6 space-y-4">
          <div class="space-y-1.5">
            <label class="text-sm font-medium text-muted-foreground">模型</label>
            <select
              bind:value={selectedModel}
              class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {#each models as model}
                <option value={model.id}>{model.id}</option>
              {/each}
            </select>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-sm font-medium text-muted-foreground">Temperature: {temperature}</label>
              <input type="range" min="0" max="2" step="0.1" bind:value={temperature} class="w-full" />
            </div>
            <div class="space-y-1.5">
              <label class="text-sm font-medium text-muted-foreground">Max Tokens</label>
              <input type="number" bind:value={maxTokens} min="1" max="32000" class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </div>
          </div>
        </Card.Content>
      </Card.Root>

      <!-- Messages -->
      <Card.Root>
        <Card.Content class="pt-6">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">消息</span>
            <button onclick={addMessage} class="text-xs text-primary hover:underline">+ 添加消息</button>
          </div>
          <div class="space-y-3">
            {#each messages as msg, i}
              <div class="flex gap-2 items-start">
                <select
                  value={msg.role}
                  onchange={(e) => { messages[i] = { ...msg, role: e.currentTarget.value }; messages = messages; }}
                  class="h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="system">system</option>
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                </select>
                <textarea
                  value={msg.content}
                  oninput={(e) => { messages[i] = { ...msg, content: e.currentTarget.value }; messages = messages; }}
                  placeholder="输入消息..."
                  rows="2"
                  class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                ></textarea>
                {#if messages.length > 1}
                  <button onclick={() => removeMessage(i)} class="p-2 text-muted-foreground hover:text-destructive transition">✕</button>
                {/if}
              </div>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>

      <Button class="w-full" disabled={loading || !selectedModel} onclick={sendRequest}>
        {loading ? '请求中...' : '发送请求'}
      </Button>
    </div>

    <!-- Output Panel -->
    <div class="space-y-4">
      {#if error}
        <div class="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive">{error}</div>
      {/if}

      <Card.Root>
        <Card.Header>
          <div class="flex items-center justify-between w-full">
            <Card.Title>响应</Card.Title>
            <div class="flex items-center gap-2">
              <button
                onclick={() => showRaw = !showRaw}
                class="text-xs px-3 py-1 rounded-lg transition {showRaw ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}"
              >
                {showRaw ? 'Raw JSON' : 'Formatted'}
              </button>
              {#if response}
                <button onclick={copyResponse} class="text-xs px-3 py-1 rounded-lg bg-muted text-muted-foreground hover:text-foreground">
                  {copied ? '✓ 已复制' : '复制'}
                </button>
              {/if}
            </div>
          </div>
        </Card.Header>
        <Card.Content>
          <div class="min-h-[300px] max-h-[500px] overflow-auto">
            {#if loading}
              <div class="flex items-center justify-center h-[300px]">
                <div class="h-6 w-6 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
              </div>
            {:else if showRaw && rawResponse}
              <pre class="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{JSON.stringify(rawResponse, null, 2)}</pre>
            {:else if response}
              <div class="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{response}</div>
            {:else}
              <div class="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                发送请求后查看响应
              </div>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>

      {#if usage}
        <Card.Root>
          <Card.Content class="pt-6">
            <div class="grid grid-cols-3 gap-4 text-center">
              <div>
                <div class="text-lg font-bold font-mono">{usage.prompt_tokens}</div>
                <div class="text-xs text-muted-foreground">Prompt</div>
              </div>
              <div>
                <div class="text-lg font-bold font-mono">{usage.completion_tokens}</div>
                <div class="text-xs text-muted-foreground">Completion</div>
              </div>
              <div>
                <div class="text-lg font-bold font-mono">{usage.total_tokens}</div>
                <div class="text-xs text-muted-foreground">Total</div>
              </div>
            </div>
          </Card.Content>
        </Card.Root>
      {/if}
    </div>
  </div>
</div>
