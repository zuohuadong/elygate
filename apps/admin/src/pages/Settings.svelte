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
    QuotaPerUnit: '500000',
    CheckinEnabled: 'false',
    CheckinReward: '100000',
    EnableTwoFactorLogin: 'true',
    PasskeyLoginEnabled: 'true',
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
    ResponseCacheEnabled: 'true',
    MemoryEnabled: 'false',
    MemoryReadDefault: 'false',
    MemoryWriteDefault: 'false',
    MemoryMaxInjectedItems: '6',
    MemoryMinWriteChars: '24',
    MemoryScope: 'user',
    MemoryEmbeddingModel: '',
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
    AutoGroups: '["vip","premium","default"]',
    ChannelAffinityEnabled: 'false',
    ModelRequestRateLimitEnabled: 'false',
    ModelRequestRateLimitCount: '0',
    ModelRequestRateLimitSuccessCount: '0',
    ModelRequestRateLimitDurationMinutes: '1',
    GroupModelRateLimits: '{}',
    UPSTREAM_TIMEOUT_MS: '30000',
    HEALTH_CHECK_INTERVAL: '60000',
    HEALTH_CHECK_USE_PROMPT: 'false',
    HEALTH_CHECK_PROMPT: 'Hi',
    HEALTH_CHECK_TIMEOUT: '10000',
  });

  let loading = $state(true);
  let saving = $state(false);
  let message = $state({ type: '', text: '' });

  function adminHeaders(contentType?: string): Record<string, string> {
    const token = localStorage.getItem('auth_token');
    return {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/admin/options', {
        credentials: 'include',
        headers: adminHeaders(),
      });
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
        headers: adminHeaders('application/json'),
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
        { key: 'QuotaPerUnit', label: '每单位充值额度', type: 'number' },
      ],
    },
    {
      title: '登录设置',
      fields: [
        { key: 'PasswordLoginEnabled', label: '密码登录', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'EnableTwoFactorLogin', label: '二步验证登录', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'PasskeyLoginEnabled', label: 'Passkey 登录', type: 'select', options: [
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
      title: '签到与用户增长',
      fields: [
        { key: 'CheckinEnabled', label: '每日签到', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'CheckinReward', label: '签到奖励额度', type: 'number' },
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
        { key: 'ResponseCacheEnabled', label: '精确缓存', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
      ],
    },
    {
      title: 'Agent Memory',
      fields: [
        { key: 'MemoryEnabled', label: '记忆能力', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'MemoryReadDefault', label: '默认读取记忆', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ], description: '请求未显式声明 memory 时是否检索并注入记忆' },
        { key: 'MemoryWriteDefault', label: '默认写入记忆', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ], description: '请求未显式声明 memory 时是否异步写入记忆' },
        { key: 'MemoryMaxInjectedItems', label: '最大注入条数', type: 'number' },
        { key: 'MemoryMinWriteChars', label: '最小写入字符数', type: 'number' },
        { key: 'MemoryScope', label: '默认 Scope', type: 'select', options: [
          { label: '用户', value: 'user' },
          { label: '组织', value: 'org' },
          { label: '线程', value: 'thread' },
        ]},
        { key: 'MemoryEmbeddingModel', label: 'Memory Embedding 模型', type: 'text', description: '需返回 1024 维向量；留空时自动选择 bge-m3 兼容渠道' },
      ],
    },
    {
      title: '渠道选择与亲和',
      fields: [
        { key: 'AutoGroups', label: 'Auto 分组列表', type: 'text', description: 'JSON 数组，如 ["vip","premium","default"]' },
        { key: 'ChannelAffinityEnabled', label: '渠道亲和', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ], description: '同一用户/会话固定到同一渠道' },
      ],
    },
    {
      title: '模型请求限流',
      fields: [
        { key: 'ModelRequestRateLimitEnabled', label: '启用限流', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'ModelRequestRateLimitCount', label: '总请求数/窗口', type: 'number', description: '0 = 不限' },
        { key: 'ModelRequestRateLimitSuccessCount', label: '成功请求数/窗口', type: 'number', description: '0 = 不限' },
        { key: 'ModelRequestRateLimitDurationMinutes', label: '窗口时长(分钟)', type: 'number' },
        { key: 'GroupModelRateLimits', label: '分组限流覆盖', type: 'text', description: 'JSON，如 {"vip":{"total":100,"success":80}}' },
      ],
    },
    {
      title: '上游超时与健康检查',
      fields: [
        { key: 'UPSTREAM_TIMEOUT_MS', label: '上游超时(ms)', type: 'number' },
        { key: 'HEALTH_CHECK_INTERVAL', label: '健康检查间隔(ms)', type: 'number' },
        { key: 'HEALTH_CHECK_USE_PROMPT', label: '健康检查用Prompt', type: 'select', options: [
          { label: '启用', value: 'true' },
          { label: '禁用', value: 'false' },
        ]},
        { key: 'HEALTH_CHECK_PROMPT', label: '健康检查Prompt', type: 'text' },
        { key: 'HEALTH_CHECK_TIMEOUT', label: '健康检查超时(ms)', type: 'number' },
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
    {#each sections as section (section.title)}
      <Card.Root>
        <Card.Header>
          <Card.Title>{section.title}</Card.Title>
        </Card.Header>
        <Card.Content>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {#each section.fields as field (field.key)}
              <div class="space-y-1.5">
                <label for={`setting-${field.key}`} class="text-sm font-medium text-muted-foreground">{field.label}</label>
                {#if field.type === 'select' && field.options}
                  <select
                    id={`setting-${field.key}`}
                    bind:value={settings[field.key]}
                    class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {#each field.options as opt (opt.value)}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                {:else if field.type === 'textarea'}
                  <textarea
                    id={`setting-${field.key}`}
                    bind:value={settings[field.key]}
                    rows="3"
                    placeholder={field.placeholder}
                    class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none font-mono"
                  ></textarea>
                {:else if field.type === 'number'}
                  <input
                    id={`setting-${field.key}`}
                    type="number"
                    bind:value={settings[field.key]}
                    class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                {:else}
                  <input
                    id={`setting-${field.key}`}
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
