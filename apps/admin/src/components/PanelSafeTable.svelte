<script lang="ts">
  import { onMount } from 'svelte';
  import { getResource } from '@svadmin/core';
  import { navigate } from '@svadmin/core/router';
  import type { FieldDefinition } from '@svadmin/core';
  import { Button, Card, PageHeader } from '@svadmin/ui';
  import { Plus, RefreshCw } from '@lucide/svelte';

  type ApiRecord = Record<string, unknown> & {
    id?: string | number;
  };

  type ListEnvelope = {
    data?: unknown;
    total?: unknown;
    success?: boolean;
    message?: unknown;
  };

  let { resourceName }: { resourceName: string } = $props();

  const resource = $derived(getResource(resourceName));
  const primaryKey = $derived(resource.primaryKey ?? 'id');
  const listFields = $derived(resource.fields.filter((field: FieldDefinition) => field.showInList !== false).slice(0, 9));

  let rows = $state.raw<ApiRecord[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let errorMessage = $state('');
  let page = $state(1);
  const pageSize = 20;

  onMount(() => {
    void loadRows();
  });

  function adminHeaders(): Record<string, string> {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function camelToSnake(value: string): string {
    return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  function normalizeRows(payload: unknown): { rows: ApiRecord[]; total: number } {
    if (Array.isArray(payload)) {
      return { rows: payload.filter(isRecord), total: payload.length };
    }

    if (!isRecord(payload)) {
      return { rows: [], total: 0 };
    }

    const envelope = payload as ListEnvelope;
    if (envelope.success === false) {
      throw new Error(typeof envelope.message === 'string' ? envelope.message : 'Request failed');
    }

    if (Array.isArray(envelope.data)) {
      return {
        rows: envelope.data.filter(isRecord),
        total: Number(envelope.total ?? envelope.data.length),
      };
    }

    return { rows: [], total: Number(envelope.total ?? 0) };
  }

  function isRecord(value: unknown): value is ApiRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function recordValue(record: ApiRecord, key: string): unknown {
    if (key in record) return record[key];
    const snakeKey = camelToSnake(key);
    if (snakeKey in record) return record[snakeKey];
    return undefined;
  }

  function optionLabel(field: FieldDefinition, value: unknown): string | null {
    const option = field.options?.find((item) => item.value === value);
    return option ? String(option.label) : null;
  }

  function formatDate(value: unknown): string {
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value !== 'string' && typeof value !== 'number') return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function formatCell(record: ApiRecord, field: FieldDefinition): string {
    const value = recordValue(record, field.key);
    if (value === null || value === undefined || value === '') return '—';

    const labeled = optionLabel(field, value);
    if (labeled) return labeled;
    if (field.type === 'boolean') return value ? '是' : '否';
    if (field.type === 'date') return formatDate(value);
    if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);

    return String(value);
  }

  async function loadRows(): Promise<void> {
    loading = true;
    errorMessage = '';
    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      const response = await fetch(`/api/admin/${resourceName}?${query.toString()}`, {
        credentials: 'include',
        headers: adminHeaders(),
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === 'string'
          ? payload.message
          : `HTTP ${response.status}`;
        throw new Error(message);
      }
      const normalized = normalizeRows(payload);
      rows = normalized.rows;
      total = normalized.total || normalized.rows.length;
    } catch (error) {
      rows = [];
      total = 0;
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  async function gotoPage(nextPage: number): Promise<void> {
    page = Math.max(1, nextPage);
    await loadRows();
  }

  function rowId(record: ApiRecord): string | number | null {
    const value = recordValue(record, primaryKey);
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
  }
</script>

<div class="space-y-6">
  <PageHeader title={resource.label}>
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={loadRows}>
        <RefreshCw class="h-4 w-4" data-icon="inline-start" /> 刷新
      </Button>
      {#if resource.canCreate !== false}
        <Button size="sm" onclick={() => navigate(`/${resourceName}/create`)}>
          <Plus class="h-4 w-4" data-icon="inline-start" /> 新增
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if errorMessage}
    <div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
      {errorMessage}
    </div>
  {/if}

  <Card.Root>
    <Card.Content class="p-0">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm">
          <thead class="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {#each listFields as field (field.key)}
                <th class="h-11 px-4 text-left font-medium whitespace-nowrap">{field.label}</th>
              {/each}
              <th class="h-11 w-[132px] px-4 text-right font-medium whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            {#if loading}
              {#each Array.from({ length: 5 }) as _, index (index)}
                <tr>
                  <td colspan={listFields.length + 1} class="px-4 py-4">
                    <div class="h-4 w-full max-w-[720px] rounded bg-muted"></div>
                  </td>
                </tr>
              {/each}
            {:else if rows.length === 0}
              <tr>
                <td colspan={listFields.length + 1} class="px-4 py-10 text-center text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            {:else}
              {#each rows as record, index (rowId(record) ?? index)}
                {@const id = rowId(record)}
                <tr class="hover:bg-muted/30">
                  {#each listFields as field (field.key)}
                    <td class="max-w-[240px] truncate px-4 py-3 align-middle" title={formatCell(record, field)}>
                      {formatCell(record, field)}
                    </td>
                  {/each}
                  <td class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-2">
                      {#if id !== null && resource.canShow !== false}
                        <Button variant="outline" size="sm" onclick={() => navigate(`/${resourceName}/show/${id}`)}>查看</Button>
                      {/if}
                      {#if id !== null && resource.canEdit !== false}
                        <Button variant="outline" size="sm" onclick={() => navigate(`/${resourceName}/edit/${id}`)}>编辑</Button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={loading || page <= 1} onclick={() => gotoPage(page - 1)}>上一页</Button>
          <span class="min-w-10 text-center">{page}</span>
          <Button variant="outline" size="sm" disabled={loading || rows.length < pageSize} onclick={() => gotoPage(page + 1)}>下一页</Button>
        </div>
      </div>
    </Card.Content>
  </Card.Root>
</div>
