<script lang="ts">
  import { useShow, getResource, useDataProvider, useNotification } from '@svadmin/core';
  import { navigate } from '@svadmin/core/router';
  import { t } from '@svadmin/core/i18n';
  import { Button, Card, Skeleton, PageHeader, getDisplayComponent, ListButton, EditButton, DeleteButton, RefreshButton } from '@svadmin/ui';
  import type { ComponentProps } from 'svelte';

  let { resourceName, id } = $props<{ resourceName: string; id: string | number }>();

  const resource = $derived(getResource(resourceName));
  const showFields = $derived(resource.fields.filter((f: any) => f.showInShow !== false));

  const query = useShow({ get resource() { return resourceName; }, get id() { return id; } });

  const notify = useNotification();
  const dataProvider = useDataProvider();

  let syncing = $state(false);

  async function handleSyncModels() {
    if (resourceName !== 'channels') return;
    try {
      syncing = true;
      await dataProvider.custom?.({ url: `/channels/${id}/models/sync`, method: 'post' });
      notify({ message: '模型同步成功', type: 'success' });
      query.query.refetch(); // Refresh after sync
    } catch (e: any) {
      notify({ message: e.message || '模型同步失败', type: 'error' });
    } finally {
      syncing = false;
    }
  }

  async function handleTest() {
    if (resourceName !== 'channels') return;
    try {
      const res = await dataProvider.custom?.({ url: `/channels/${id}/test`, method: 'post' });
      const latencyStr = res?.data?.latency ? ` (延迟: ${res.data.latency}ms)` : '';
      notify({ message: `测试成功${latencyStr}`, type: 'success' });
    } catch (e: any) {
      notify({ message: e.message || '测试失败', type: 'error' });
    }
  }
</script>

<div class="space-y-6">
  <PageHeader title="{resource.label} {t('common.detail')}">
    {#snippet actions()}
      <ListButton resource={resourceName} hideText />
      {#if resource.canEdit !== false}
        <EditButton resource={resourceName} recordItemId={id} hideText />
      {/if}
      {#if resource.canDelete !== false}
        <DeleteButton resource={resourceName} recordItemId={id} hideText onSuccess={() => navigate(`/${resourceName}`)} />
      {/if}

      <!-- Custom actions for Channels -->
      {#if resourceName === 'channels'}
        <Button variant="outline" size="sm" onclick={handleTest}>测试</Button>
        <Button variant="outline" size="sm" disabled={syncing} onclick={handleSyncModels}>
          {syncing ? '同步中...' : '同步模型'}
        </Button>
      {/if}

      <RefreshButton resource={resourceName} hideText />
    {/snippet}
  </PageHeader>

  {#if query.query.isLoading}
    <Card.Root>
      <Card.Content class="divide-y divide-border p-0">
        {#each showFields.slice(0, 6) as _}
          <div class="flex flex-col sm:flex-row px-4 sm:px-6 py-3 sm:py-4">
            <Skeleton class="h-4 w-1/2 sm:w-1/4" />
            <Skeleton class="h-4 w-3/4 sm:w-2/5 mt-1 sm:mt-0 sm:ml-auto" />
          </div>
        {/each}
      </Card.Content>
    </Card.Root>
  {:else if query.query.data?.data}
    <Card.Root>
      <Card.Content class="divide-y divide-border p-0">
        {#each showFields as field}
          {@const value = (query.query.data!.data as Record<string, unknown>)[field.key]}
          {@const DisplayComponent = getDisplayComponent(field.type)}
          <div class="flex flex-col sm:flex-row px-4 sm:px-6 py-3 sm:py-4">
            <div class="sm:w-1/3 text-xs sm:text-sm font-medium text-muted-foreground mb-1 sm:mb-0">{field.label}</div>
            <div class="sm:w-2/3 text-sm text-foreground">
              {#if DisplayComponent && value != null}
                <DisplayComponent
                  {value}
                  options={field.options}
                  resourceName={field.resource}
                />
              {:else}
                {value != null ? String(value) : '—'}
              {/if}
            </div>
          </div>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
