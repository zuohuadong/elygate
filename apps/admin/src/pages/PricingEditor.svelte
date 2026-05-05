<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, PageHeader } from '@svadmin/ui';

  let modelRatio = $state<Record<string, number>>({});
  let completionRatio = $state<Record<string, number>>({});
  let groupRatio = $state<Record<string, number>>({});
  let fixedCostModels = $state<Record<string, number>>({});
  let missing = $state<string[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let message = $state({ type: '', text: '' });
  let newModelName = $state('');
  let newModelRatio = $state(1);
  let newGroupKey = $state('');
  let newGroupRatio = $state(1);

  onMount(async () => {
    try {
      const res = await fetch('/api/admin/performance/ratio-config', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        modelRatio = json.data?.modelRatio || {};
        completionRatio = json.data?.completionRatio || {};
        groupRatio = json.data?.groupRatio || {};
        fixedCostModels = json.data?.fixedCostModels || {};
      }
      const missRes = await fetch('/api/admin/performance/ratio-config/missing', { credentials: 'include' });
      if (missRes.ok) {
        const json = await missRes.json();
        missing = json.data || [];
      }
    } catch (e) { console.error(e); }
    finally { loading = false; }
  });

  async function handleSave() {
    saving = true;
    message = { type: '', text: '' };
    try {
      const res = await fetch('/api/admin/performance/ratio-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ modelRatio, completionRatio, groupRatio, fixedCostModels }),
      });
      if (res.ok) { message = { type: 'success', text: '倍率配置已保存' }; setTimeout(() => message = { type: '', text: '' }, 3000); }
      else throw new Error('Save failed');
    } catch (e: any) {
      message = { type: 'error', text: e.message || '保存失败' };
    } finally { saving = false; }
  }

  function addModel() {
    if (!newModelName) return;
    modelRatio[newModelName] = newModelRatio;
    newModelName = '';
    newModelRatio = 1;
  }

  function removeModel(key: string) { delete modelRatio[key]; modelRatio = { ...modelRatio }; }

  function addGroup() {
    if (!newGroupKey) return;
    groupRatio[newGroupKey] = newGroupRatio;
    newGroupKey = '';
    newGroupRatio = 1;
  }

  function removeGroup(key: string) { delete groupRatio[key]; groupRatio = { ...groupRatio }; }

  function addMissing(m: string) {
    modelRatio[m] = 1;
    missing = missing.filter(x => x !== m);
  }
</script>

<div class="space-y-6">
  <PageHeader title="倍率管理" description="模型倍率、补全倍率、分组倍率">
    {#snippet actions()}
      <Button size="sm" disabled={saving} onclick={handleSave}>
        {saving ? '保存中...' : '保存倍率'}
      </Button>
    {/snippet}
  </PageHeader>

  {#if message.text}
    <div class="px-4 py-3 rounded-lg text-sm {message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}">
      {message.text}
    </div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-12"><div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div></div>
  {:else}
    {#if missing.length > 0}
      <Card.Root>
        <Card.Header><Card.Title>缺失倍率的模型 ({missing.length})</Card.Title></Card.Header>
        <Card.Content>
          <div class="flex flex-wrap gap-2">
            {#each missing as m}
              <button class="px-2 py-1 text-xs rounded border hover:bg-muted" onclick={() => addMissing(m)}>
                {m} +
              </button>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    <div class="grid gap-6 lg:grid-cols-2">
      <Card.Root>
        <Card.Header><Card.Title>模型倍率 ({Object.keys(modelRatio).length})</Card.Title></Card.Header>
        <Card.Content>
          <div class="space-y-2 mb-4">
            <div class="flex gap-2">
              <input type="text" bind:value={newModelName} placeholder="模型名" class="flex-1 h-8 rounded border px-2 text-sm" />
              <input type="number" bind:value={newModelRatio} step="0.01" class="w-24 h-8 rounded border px-2 text-sm" />
              <button class="px-3 py-1 text-xs rounded bg-primary text-primary-foreground" onclick={addModel}>添加</button>
            </div>
          </div>
          <div class="max-h-96 overflow-y-auto space-y-1">
            {#each Object.entries(modelRatio).sort(([a], [b]) => a.localeCompare(b)) as [key, val]}
              <div class="flex items-center justify-between py-1 px-2 rounded hover:bg-muted text-sm">
                <span class="font-mono text-xs truncate flex-1">{key}</span>
                <input type="number" bind:value={modelRatio[key]} step="0.01" class="w-20 h-7 rounded border px-1 text-xs text-right" />
                <button class="text-destructive text-xs ml-2" onclick={() => removeModel(key)}>X</button>
              </div>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>

      <div class="space-y-6">
        <Card.Root>
          <Card.Header><Card.Title>分组倍率 ({Object.keys(groupRatio).length})</Card.Title></Card.Header>
          <Card.Content>
            <div class="flex gap-2 mb-4">
              <input type="text" bind:value={newGroupKey} placeholder="分组名" class="flex-1 h-8 rounded border px-2 text-sm" />
              <input type="number" bind:value={newGroupRatio} step="0.01" class="w-24 h-8 rounded border px-2 text-sm" />
              <button class="px-3 py-1 text-xs rounded bg-primary text-primary-foreground" onclick={addGroup}>添加</button>
            </div>
            {#each Object.entries(groupRatio) as [key, val]}
              <div class="flex items-center justify-between py-1 px-2 rounded hover:bg-muted text-sm">
                <span class="font-mono text-xs">{key}</span>
                <input type="number" bind:value={groupRatio[key]} step="0.01" class="w-20 h-7 rounded border px-1 text-xs text-right" />
                <button class="text-destructive text-xs ml-2" onclick={() => removeGroup(key)}>X</button>
              </div>
            {/each}
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header><Card.Title>补全倍率 ({Object.keys(completionRatio).length})</Card.Title></Card.Header>
          <Card.Content>
            <div class="max-h-64 overflow-y-auto space-y-1">
              {#each Object.entries(completionRatio).sort(([a], [b]) => a.localeCompare(b)) as [key, val]}
                <div class="flex items-center justify-between py-1 px-2 rounded hover:bg-muted text-sm">
                  <span class="font-mono text-xs truncate flex-1">{key}</span>
                  <input type="number" bind:value={completionRatio[key]} step="0.01" class="w-20 h-7 rounded border px-1 text-xs text-right" />
                </div>
              {/each}
            </div>
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  {/if}
</div>
