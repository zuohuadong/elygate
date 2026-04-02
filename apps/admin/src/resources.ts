import type { ResourceDefinition } from '@svadmin/core';

export const resources: ResourceDefinition[] = [
  // ─── Admin CRUD Resources ────────────────────────────────────
  {
    name: 'channels',
    label: '渠道',
    icon: 'radio',
    primaryKey: 'id',
    fields: [
      { key: 'id', label: 'ID', type: 'number', showInForm: false, width: '60px' },
      { key: 'name', label: '名称', type: 'text', required: true, searchable: true },
      { key: 'type', label: '类型', type: 'select', options: [
        { label: 'OpenAI', value: 1 },
        { label: 'Gemini', value: 15 },
        { label: 'Anthropic', value: 14 },
      ] },
      { key: 'baseUrl', label: 'Base URL', type: 'url', required: true },
      { key: 'key', label: '密钥', type: 'textarea', showInList: false, required: true },
      { key: 'models', label: '模型', type: 'tags', showInList: false },
      { key: 'status', label: '状态', type: 'select', options: [
        { label: '在线', value: 1 },
        { label: '测试中', value: 2 },
        { label: '已禁用', value: 3 },
      ], filterable: true },
      { key: 'priority', label: '优先级', type: 'number' },
      { key: 'weight', label: '权重', type: 'number' },
    ],
    defaultSort: { field: 'id', order: 'desc' },
  },
  {
    name: 'users',
    label: '用户',
    icon: 'users',
    fields: [
      { key: 'id', label: 'ID', type: 'number', showInForm: false, width: '60px' },
      { key: 'username', label: '用户名', type: 'text', required: true, searchable: true },
      { key: 'password', label: '密码', type: 'password', showInList: false },
      { key: 'role', label: '角色', type: 'select', options: [
        { label: '普通用户', value: 1 },
        { label: '管理员', value: 10 },
      ] },
      { key: 'quota', label: '总额度', type: 'number' },
      { key: 'usedQuota', label: '已用额度', type: 'number', showInForm: false },
      { key: 'status', label: '状态', type: 'select', options: [
        { label: '正常', value: 1 },
        { label: '禁用', value: 2 },
      ] },
    ],
    defaultSort: { field: 'id', order: 'desc' },
  },
  {
    name: 'tokens',
    label: '令牌',
    icon: 'key',
    fields: [
      { key: 'id', label: 'ID', type: 'number', showInForm: false, width: '60px' },
      { key: 'name', label: '名称', type: 'text', required: true, searchable: true },
      { key: 'key', label: 'Key', type: 'text', showInForm: false },
      { key: 'status', label: '状态', type: 'select', options: [
        { label: '正常', value: 1 },
        { label: '禁用', value: 2 },
      ] },
      { key: 'remainQuota', label: '剩余额度', type: 'number' },
      { key: 'usedQuota', label: '已用额度', type: 'number', showInForm: false },
      { key: 'models', label: '绑定模型', type: 'tags' },
      { key: 'userId', label: '所属用户 ID', type: 'number' },
      { key: 'creatorName', label: '创建人', type: 'text', showInForm: false },
    ],
    defaultSort: { field: 'id', order: 'desc' },
  },
  {
    name: 'user-groups',
    label: '分组',
    icon: 'folder',
    primaryKey: 'key',
    fields: [
      { key: 'key', label: '分组标识', type: 'text', required: true, searchable: true },
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'description', label: '描述', type: 'textarea' },
      { key: 'status', label: '状态', type: 'select', options: [
        { label: '启用', value: 1 },
        { label: '禁用', value: 2 },
      ] },
    ],
  },
  {
    name: 'packages',
    label: '套餐',
    icon: 'package',
    fields: [
      { key: 'id', label: 'ID', type: 'number', showInForm: false, width: '60px' },
      { key: 'name', label: '套餐名', type: 'text', required: true, searchable: true },
      { key: 'price', label: '价格', type: 'number' },
      { key: 'durationDays', label: '时长(天)', type: 'number' },
      { key: 'models', label: '包含模型', type: 'tags', showInList: false },
      { key: 'isPublic', label: '是否公开', type: 'boolean' },
    ],
    defaultSort: { field: 'id', order: 'desc' },
  },
  {
    name: 'redemptions',
    label: '兑换码',
    icon: 'gift',
    fields: [
      { key: 'id', label: 'ID', type: 'number', showInForm: false, width: '60px' },
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'key', label: '兑换码', type: 'text' },
      { key: 'quota', label: '额度', type: 'number', required: true },
      { key: 'count', label: '次数', type: 'number' },
      { key: 'status', label: '状态', type: 'select', options: [
        { label: '正常', value: 1 },
        { label: '失效', value: 2 },
      ] },
    ],
    defaultSort: { field: 'id', order: 'desc' },
  },
  {
    name: 'rate-limits',
    label: '限流策略',
    icon: 'shield',
    fields: [
      { key: 'id', label: 'ID', type: 'number', showInForm: false, width: '60px' },
      { key: 'name', label: '策略名', type: 'text', required: true },
      { key: 'rpm', label: 'RPM', type: 'number' },
      { key: 'rph', label: 'RPH', type: 'number' },
      { key: 'concurrent', label: '并发数', type: 'number' },
    ],
    defaultSort: { field: 'id', order: 'desc' },
  },

  // ─── Virtual Resources (custom pages, no CRUD) ───────────────
  // These are intercepted by CustomAutoTable and rendered as custom Svelte pages.
  {
    name: 'system-options',
    label: '系统设置',
    icon: 'settings',
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canShow: false,
    fields: [],
  },
  {
    name: 'models',
    label: '模型状态',
    icon: 'cpu',
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canShow: false,
    fields: [],
  },
  {
    name: 'playground',
    label: 'API 测试',
    icon: 'play',
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canShow: false,
    fields: [],
  },
];
