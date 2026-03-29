<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, Input, Badge, PageHeader } from '@svadmin/ui';

  let settings = $state<Record<string, string>>({
    ServerName: 'Elygate',
    RegisterMode: 'open',
    SignRegisterQuota: '500000',
    DefaultGroup: 'default',
    DefaultCurrency: 'USD',
    ExchangeRate: '7.2',
    PaymentEnabled: 'true',
    PaymentMethods: 'redemption',
    PasswordLoginEnabled: 'true',
    GitHubOAuthEnabled: 'false',
    GitHubClientId: '',
    GitHubClientSecret: '',
    SMTPServer: '',
    SMTPPort: '465',
    SMTPAccount: '',
    SMTPPassword: '',
    AlertThresholdWarning: '50',
    AlertThresholdCritical: '80',
    EnableHealthCheck: 'false',
    CircuitBreakerThreshold: '5',
    CircuitBreakerRecoveryThreshold: '3',
    LogRetentionDays: '7',
    SemanticCacheEnabled: 'true',
    ResponseCacheEnabled: 'true',
    SemanticCacheThreshold: '0.95',
    SemanticCacheTTLHours: '24',
    SemanticCacheEmbeddingModel: 'text-embedding-3-small',
    SEO_Title: 'Elygate',
    SEO_Description: '',
    SEO_Keywords: '',
    Logo_URL: '',
    Footer_HTML: '',
    Custom_CSS: '',
    Custom_JS: '',
    WebhookURL: '',
    Notify_On_Channel_Offline: 'true',
    ChannelSelectionStrategy: 'priority',
  });

  let loading = $state(true);
  let saving = $state(false);
  let message = $state({ type: '', text: '' });

  onMount(async () => {
    try {
      const res = await fetch('/api/admin/options', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        settings = { ...settings, ...data };
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    } finally {
      loading = false;
    }
  });

  async function handleSave() {
    saving = true;
    message = { type: '', text: '' };
    try {
      const res = await fetch('/api/admin/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        message = { type: 'success', text: '保存成功' };
        setTimeout(() => (message = { type: '', text: '' }), 3000);
      } else {
        throw new Error('Save failed');
      }
    } catch (e: any) {
      message = { type: 'error', text: e.message || '保存失败' };
    } finally {
      saving = false;
    }
  }

  async function checkEmbedding() {
    try {
      const res = await fetch('/api/admin/check-embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ model: settings.SemanticCacheEmbeddingModel }),
      });
      const data = await res.json();
      message = {
        type: data.success ? 'success' : 'error',
        text: data.message + (data.channel ? ` (${data.channel})` : ''),
      };
    } catch (e: any) {
      message = { type: 'error', text: e.message || '检测失败' };
    }
  }

  // Reusable section type
  type Section = {
    title: string;
    fields: { key: string; label: string; type: 'text' | 'select' | 'number' | 'textarea' | 'toggle'; options?: { label: string; value: string }[]; placeholder?: string; description?: string }[];
  };

  const sections: Section[] = [
    {
      title: '通用设置',
      fields: [
        { key: 'ServerName', label: '系统名称', type: 'text', placeholder: 'Elygate' },
        { key: 'ChannelSelectionStrategy', label: '渠道选择策略', type: 'select', options: [
          { label: '优先级优先', value: 'priority' },
          { label: '加权随机', value: 'weighted' },
        ]},
      ],
    },
    {
      title: '注册设置',
      fields: [
        { key: 'RegisterMode', label: '注册模式', type: 'select', options: [
          { label: '开放注册', value: 'open' },
          { label: '邀请码注册', value: 'invite' },
          { label: '关闭注册', value: 'closed' },
        ]},
        { key: 'SignRegisterQuota', label: '初始额度', type: 'number', description: '新用户注册获得的初始额度' },
      ],
    },
    {
      title: '货币与汇率',
      fields: [
        { key: 'DefaultCurrency', label: '默认货币', type: 'select', options: [
          { label: 'USD ($)', value: 'USD' },
          { label: 'RMB (¥)', value: 'RMB' },
        ]},
        { key: 'ExchangeRate', label: '汇率 (1 USD = ? RMB)', type: 'number' },
      ],
    },
    {
      title: '充值设置',
      fields: [
        { key: 'PaymentEnabled', label: '充值功能', type: 'select', options: [
          { label: '开启', value: 'true' },
          { label: '关闭', value: 'false' },
        ]},
        { key: 'PaymentMethods', label: '充值方式', type: 'select', options: [
          { label: '兑换码', value: 'redemption' },
          { label: '在线支付', value: 'online' },
          { label: '两者皆有', value: 'both' },
        ]},
      ],
    },
    {
      title: '登录设置',
      fields: [
        { key: 'PasswordLoginEnabled', label: '密码登录', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'GitHubOAuthEnabled', label: 'GitHub OAuth', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'GitHubClientId', label: 'GitHub Client ID', type: 'text' },
        { key: 'GitHubClientSecret', label: 'GitHub Client Secret', type: 'text' },
      ],
    },
    {
      title: 'SEO 设置',
      fields: [
        { key: 'SEO_Title', label: '站点标题', type: 'text', placeholder: 'Elygate' },
        { key: 'SEO_Description', label: '站点描述', type: 'textarea' },
        { key: 'SEO_Keywords', label: '关键字', type: 'text', placeholder: 'AI, API, Gateway' },
      ],
    },
    {
      title: '品牌定制',
      fields: [
        { key: 'Logo_URL', label: 'Logo URL', type: 'text', placeholder: 'https://example.com/logo.png' },
        { key: 'Footer_HTML', label: '页脚 HTML', type: 'textarea' },
        { key: 'Custom_CSS', label: '自定义 CSS', type: 'textarea' },
        { key: 'Custom_JS', label: '自定义 JS', type: 'textarea' },
      ],
    },
    {
      title: '监控与告警',
      fields: [
        { key: 'WebhookURL', label: 'Webhook URL', type: 'text' },
        { key: 'Notify_On_Channel_Offline', label: '渠道离线告警', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'EnableHealthCheck', label: '健康检查', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'CircuitBreakerThreshold', label: '熔断阈值', type: 'number' },
        { key: 'CircuitBreakerRecoveryThreshold', label: '恢复阈值', type: 'number' },
        { key: 'LogRetentionDays', label: '日志保留天数', type: 'number' },
      ],
    },
    {
      title: '缓存设置',
      fields: [
        { key: 'SemanticCacheEnabled', label: '语义缓存', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'ResponseCacheEnabled', label: '精确缓存', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'SemanticCacheThreshold', label: '语义相似度阈值', type: 'number', description: '0-1，越高越严格' },
        { key: 'SemanticCacheTTLHours', label: '缓存有效期 (小时)', type: 'number' },
        { key: 'SemanticCacheEmbeddingModel', label: 'Embedding 模型', type: 'text' },
      ],
    },
    {
      title: 'SMTP 邮件',
      fields: [
        { key: 'SMTPServer', label: 'SMTP 服务器', type: 'text' },
        { key: 'SMTPPort', label: '端口', type: 'number' },
        { key: 'SMTPAccount', label: '账号', type: 'text' },
        { key: 'SMTPPassword', label: '密码', type: 'text' },
      ],
    },
  ];
</script>

<div class="space-y-6">
  <PageHeader title="系统设置" description="管理系统运行参数">
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={checkEmbedding}>
        检测 Embedding
      </Button>
      <Button size="sm" disabled={saving} onclick={handleSave}>
        {saving ? '保存中...' : '保存设置'}
      </Button>
    {/snippet}
  </PageHeader>

  {#if message.text}
    <div class="px-4 py-3 rounded-lg text-sm {message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'}">
      {message.text}
    </div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
    </div>
  {:else}
    {#each sections as section}
      <Card.Root>
        <Card.Header>
          <Card.Title>{section.title}</Card.Title>
        </Card.Header>
        <Card.Content>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {#each section.fields as field}
              <div class="space-y-1.5">
                <label class="text-sm font-medium text-muted-foreground">{field.label}</label>
                {#if field.type === 'select' && field.options}
                  <select
                    bind:value={settings[field.key]}
                    class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {#each field.options as opt}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                {:else if field.type === 'textarea'}
                  <textarea
                    bind:value={settings[field.key]}
                    rows="3"
                    placeholder={field.placeholder}
                    class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none font-mono"
                  ></textarea>
                {:else if field.type === 'number'}
                  <input
                    type="number"
                    bind:value={settings[field.key]}
                    class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                {:else}
                  <input
                    type="text"
                    bind:value={settings[field.key]}
                    placeholder={field.placeholder}
                    class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                {/if}
                {#if field.description}
                  <p class="text-xs text-muted-foreground">{field.description}</p>
                {/if}
              </div>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  {/if}
</div>
