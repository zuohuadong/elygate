<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, PageHeader } from '@svadmin/ui';

  let content = $state<Record<string, string>>({});
  let loading = $state(true);
  let saving = $state(false);
  let message = $state({ type: '', text: '' });

  const fields: { key: string; label: string; type: 'text' | 'textarea' }[] = [
    { key: 'Notice', label: '系统公告', type: 'textarea' },
    { key: 'HomePageContent', label: '首页内容 (HTML)', type: 'textarea' },
    { key: 'About', label: '关于我们', type: 'textarea' },
    { key: 'PricingContent', label: '定价页内容 (HTML)', type: 'textarea' },
    { key: 'FAQ', label: 'FAQ', type: 'textarea' },
    { key: 'PrivacyPolicy', label: '隐私政策', type: 'textarea' },
    { key: 'UserAgreement', label: '用户协议', type: 'textarea' },
    { key: 'SEO_Title', label: 'SEO 标题', type: 'text' },
    { key: 'SEO_Description', label: 'SEO 描述', type: 'text' },
    { key: 'SEO_Keywords', label: 'SEO 关键词', type: 'text' },
    { key: 'Logo_URL', label: 'Logo URL', type: 'text' },
    { key: 'Favicon', label: 'Favicon URL', type: 'text' },
    { key: 'Footer_HTML', label: '页脚 HTML', type: 'textarea' },
    { key: 'Custom_CSS', label: '自定义 CSS', type: 'textarea' },
    { key: 'Custom_JS', label: '自定义 JS', type: 'textarea' },
    { key: 'ServerName', label: '系统名称', type: 'text' },
    { key: 'ServerAddress', label: '服务器地址', type: 'text' },
    { key: 'GithubUrl', label: 'GitHub URL', type: 'text' },
  ];

  function authHeaders(extra: Record<string, string> = {}) {
    const token = localStorage.getItem('auth_token');
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/admin/content', { credentials: 'include', headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        content = json.data || {};
      }
    } catch (e) { console.error(e); }
    finally { loading = false; }
  });

  async function handleSave() {
    saving = true;
    message = { type: '', text: '' };
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify(content),
      });
      if (res.ok) { message = { type: 'success', text: '保存成功' }; setTimeout(() => message = { type: '', text: '' }, 3000); }
      else throw new Error('Save failed');
    } catch (e: any) {
      message = { type: 'error', text: e.message || '保存失败' };
    } finally { saving = false; }
  }
</script>

<div class="space-y-6">
  <PageHeader title="内容管理" description="公告、关于、隐私、协议、SEO">
    {#snippet actions()}
      <Button size="sm" disabled={saving} onclick={handleSave}>
        {saving ? '保存中...' : '保存'}
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
    <div class="grid gap-6 lg:grid-cols-2">
      {#each fields as field (field.key)}
        <Card.Root>
          <Card.Content class="pt-6 space-y-2">
            <label for={`content-${field.key}`} class="text-sm font-medium text-muted-foreground">{field.label}</label>
            {#if field.type === 'textarea'}
              <textarea
                id={`content-${field.key}`}
                bind:value={content[field.key]}
                rows="6"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
              ></textarea>
            {:else}
              <input
                id={`content-${field.key}`}
                type="text"
                bind:value={content[field.key]}
                class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            {/if}
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
