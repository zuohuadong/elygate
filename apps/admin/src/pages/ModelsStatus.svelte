<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, Badge, PageHeader } from '@svadmin/ui';

  interface Model {
    id: string;
    name: string;
    description: string;
    status: 'online' | 'offline' | 'busy';
    latency: number;
  }

  let models = $state<Model[]>([]);
  let loading = $state(true);
  let filter = $state('all');

  onMount(async () => {
    try {
      const res = await fetch('/api/admin/models', { credentials: 'include' });
      if (res.ok) models = await res.json();
    } catch (e) {
      console.error('Failed to load models', e);
    } finally {
      loading = false;
    }
  });

  const filteredModels = $derived(
    filter === 'all' ? models : models.filter(m => m.status === filter)
  );

  const counts = $derived({
    total: models.length,
    online: models.filter(m => m.status === 'online').length,
    offline: models.filter(m => m.status === 'offline').length,
    busy: models.filter(m => m.status === 'busy').length,
  });

  function statusColor(s: string) {
    if (s === 'online') return 'bg-emerald-500';
    if (s === 'busy') return 'bg-amber-500';
    return 'bg-red-500';
  }
  
  function statusBadge(s: string) {
    if (s === 'online') return 'default';
    if (s === 'busy') return 'secondary';
    return 'destructive';
  }
</script>

<div class="space-y-6">
  <PageHeader title="模型状态" description="查看可用模型的实时状态和延迟">
    {#snippet actions()}
      <div class="flex items-center gap-1 bg-muted p-1 rounded-lg">
        <button class="px-3 py-1 text-xs font-medium rounded-md transition-colors {filter === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}" onclick={() => filter = 'all'}>
          全部 ({counts.total})
        </button>
        <button class="px-3 py-1 text-xs font-medium rounded-md transition-colors {filter === 'online' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}" onclick={() => filter = 'online'}>
          在线 ({counts.online})
        </button>
        <button class="px-3 py-1 text-xs font-medium rounded-md transition-colors {filter === 'offline' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}" onclick={() => filter = 'offline'}>
          离线 ({counts.offline})
        </button>
      </div>
    {/snippet}
  </PageHeader>

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each filteredModels as model (model.id)}
        <Card.Root class="hover:border-primary/30 transition-colors">
          <Card.Content class="pt-6">
            <div class="flex items-start justify-between">
              <div class="space-y-1 min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full {statusColor(model.status)} animate-pulse"></span>
                  <h3 class="font-medium text-sm text-foreground truncate">{model.name}</h3>
                </div>
                <p class="text-xs text-muted-foreground font-mono truncate">{model.id}</p>
              </div>
              <Badge variant={statusBadge(model.status) as any}>
                {model.status === 'online' ? '在线' : model.status === 'busy' ? '繁忙' : '离线'}
              </Badge>
            </div>
            {#if model.status !== 'offline'}
              <div class="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>延迟</span>
                <span class="font-mono font-medium {model.latency < 1000 ? 'text-emerald-600 dark:text-emerald-400' : model.latency < 3000 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}">
                  {model.latency}ms
                </span>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
    {#if filteredModels.length === 0}
      <div class="text-center py-12 text-muted-foreground text-sm">没有找到匹配的模型</div>
    {/if}
  {/if}
</div>
