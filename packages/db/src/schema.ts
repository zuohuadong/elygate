import {
    bigint,
    boolean,
    date,
    decimal,
    integer,
    jsonb,
    pgTable,
    serial,
    text,
    timestamp,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';

export const userGroups = pgTable('user_groups', {
    key: varchar('key', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    allowedChannelTypes: jsonb('allowed_channel_types').$type<number[]>().default([]),
    deniedChannelTypes: jsonb('denied_channel_types').$type<number[]>().default([]),
    allowedModels: jsonb('allowed_models').$type<string[]>().default([]),
    deniedModels: jsonb('denied_models').$type<string[]>().default([]),
    allowedPackages: jsonb('allowed_packages').$type<number[]>().default([]),
    status: integer('status').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const organizations = pgTable('organizations', {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 80 }).unique(),
    name: varchar('name', { length: 120 }).notNull(),
    billingEmail: text('billing_email'),
    quota: bigint('quota', { mode: 'number' }).notNull().default(0),
    usedQuota: bigint('used_quota', { mode: 'number' }).notNull().default(0),
    allowedModels: jsonb('allowed_models').$type<string[]>().notNull().default([]),
    deniedModels: jsonb('denied_models').$type<string[]>().notNull().default([]),
    allowedSubnets: text('allowed_subnets').notNull().default(''),
    quotaAlarmThreshold: integer('quota_alarm_threshold').notNull().default(80),
    alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
    alertWebhookUrl: text('alert_webhook_url'),
    lastAlertAt: timestamp('last_alert_at', { withTimezone: true }),
    status: integer('status').notNull().default(1),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    username: text('username').notNull().unique(),
    email: text('email'),
    emailVerified: boolean('email_verified').default(false),
    name: text('name'),
    passwordHash: text('password_hash').notNull().default(''),
    image: text('image'),
    role: integer('role').notNull().default(1),
    orgId: integer('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    quota: bigint('quota', { mode: 'number' }).notNull().default(0),
    usedQuota: bigint('used_quota', { mode: 'number' }).notNull().default(0),
    group: text('group').notNull().default('default'),
    status: integer('status').notNull().default(1),
    currency: text('currency').notNull().default('USD'),
    githubId: text('github_id'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    twoFactorSecret: text('two_factor_secret'),
    twoFactorPendingSecret: text('two_factor_pending_secret'),
    twoFactorBackupCodes: jsonb('two_factor_backup_codes').$type<string[]>().default([]),
    twoFactorPendingBackupCodes: jsonb('two_factor_pending_backup_codes').$type<string[]>().default([]),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable('session', {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const tokens = pgTable('tokens', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    orgId: integer('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    status: integer('status').notNull().default(1),
    remainQuota: bigint('remain_quota', { mode: 'number' }).notNull().default(-1),
    usedQuota: bigint('used_quota', { mode: 'number' }).notNull().default(0),
    models: jsonb('models').$type<string[] | null>(),
    subnet: text('subnet'),
    allowIps: text('allow_ips'),
    rateLimit: integer('rate_limit').notNull().default(0),
    unlimitedQuota: boolean('unlimited_quota').notNull().default(false),
    modelLimitsEnabled: boolean('model_limits_enabled').notNull().default(false),
    tokenGroup: text('token_group'),
    crossGroupRetry: boolean('cross_group_retry').notNull().default(false),
    accessedAt: timestamp('accessed_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const channels = pgTable('channels', {
    id: serial('id').primaryKey(),
    type: integer('type').notNull().default(1),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull().default('https://api.openai.com'),
    key: text('key').notNull(),
    models: jsonb('models').$type<string[]>().notNull().default([]),
    modelMapping: jsonb('model_mapping').$type<Record<string, string>>().notNull().default({}),
    weight: integer('weight').notNull().default(1),
    priority: integer('priority').notNull().default(0),
    groups: jsonb('groups').$type<string[] | null>(),
    status: integer('status').notNull().default(1),
    statusMessage: text('status_message'),
    keyStrategy: integer('key_strategy').notNull().default(0),
    keyStatus: jsonb('key_status').$type<Record<string, unknown>>().notNull().default({}),
    keyConcurrencyLimit: integer('key_concurrency_limit').notNull().default(0),
    endpointType: text('endpoint_type').notNull().default('auto'),
    priceRatio: decimal('price_ratio', { precision: 10, scale: 4 }).default('1.0'),
    testModel: text('test_model'),
    openaiOrganization: text('openai_organization'),
    balance: decimal('balance', { precision: 20, scale: 8 }),
    balanceUpdatedAt: timestamp('balance_updated_at', { withTimezone: true }),
    responseTime: integer('response_time'),
    statusCodeMapping: jsonb('status_code_mapping').$type<Record<string, unknown>>().notNull().default({}),
    autoBan: integer('auto_ban').notNull().default(1),
    tag: text('tag'),
    setting: jsonb('setting').$type<Record<string, unknown>>().notNull().default({}),
    paramOverride: jsonb('param_override').$type<Record<string, unknown>>().notNull().default({}),
    headerOverride: jsonb('header_override').$type<Record<string, unknown>>().notNull().default({}),
    remark: text('remark'),
    channelInfo: jsonb('channel_info').$type<Record<string, unknown>>().notNull().default({}),
    testErrors: integer('test_errors').notNull().default(0),
    testAt: timestamp('test_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const rateLimitRules = pgTable('rate_limit_rules', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    rpm: integer('rpm').default(0),
    rph: integer('rph').default(0),
    concurrent: integer('concurrent').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const packages = pgTable('packages', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    durationDays: integer('duration_days').notNull().default(30),
    models: jsonb('models').$type<string[]>().default([]),
    defaultRateLimitId: integer('default_rate_limit_id').references(() => rateLimitRules.id, { onDelete: 'set null' }),
    modelRateLimits: jsonb('model_rate_limits').$type<Record<string, unknown>>().default({}),
    cycleQuota: bigint('cycle_quota', { mode: 'number' }).default(0),
    cycleInterval: integer('cycle_interval').default(1),
    cycleUnit: text('cycle_unit').default('day'),
    cachePolicy: jsonb('cache_policy').$type<Record<string, unknown>>().default({ mode: 'default' }),
    isPublic: boolean('is_public').default(true),
    allowedGroups: jsonb('allowed_groups').$type<string[]>().default([]),
    addedBy: integer('added_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const redemptions = pgTable('redemptions', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    quota: bigint('quota', { mode: 'number' }).notNull().default(0),
    count: integer('count').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    status: integer('status').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const logs = pgTable('logs', {
    id: serial('id'),
    userId: integer('user_id').notNull(),
    tokenId: integer('token_id'),
    channelId: integer('channel_id'),
    modelName: text('model_name').notNull(),
    quotaCost: bigint('quota_cost', { mode: 'number' }).notNull().default(0),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    elapsedMs: integer('elapsed_ms').notNull().default(0),
    isStream: boolean('is_stream').default(false),
    errorMessage: text('error_message'),
    statusCode: integer('status_code').notNull().default(200),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    traceId: text('trace_id'),
    orgId: integer('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    externalTaskId: text('external_task_id'),
    externalUserId: text('external_user_id'),
    externalWorkspaceId: text('external_workspace_id'),
    externalFeatureType: text('external_feature_type'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const modelMetadata = pgTable('model_metadata', {
    id: serial('id').primaryKey(),
    modelName: text('model_name').notNull().unique(),
    type: text('type').notNull().default('chat'),
    endpoint: text('endpoint'),
    displayName: text('display_name'),
    tags: jsonb('tags').$type<string[]>().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const tokenCache = pgTable('token_cache', {
    keyHash: text('key_hash').primaryKey(),
    tokenData: jsonb('token_data').$type<Record<string, unknown>>().notNull(),
    userId: integer('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
});

export const userQuotaCache = pgTable('user_quota_cache', {
    userId: integer('user_id').primaryKey(),
    quota: bigint('quota', { mode: 'number' }).notNull(),
    usedQuota: bigint('used_quota', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const options = pgTable('options', {
    key: text('key').primaryKey(),
    value: text('value').notNull().default(''),
});

export const vendors = pgTable('vendors', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    type: integer('type').default(0),
    baseUrl: text('base_url').default(''),
    logoUrl: text('logo_url').default(''),
    description: text('description').default(''),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const tasks = pgTable('tasks', {
    id: serial('id').primaryKey(),
    type: varchar('type', { length: 50 }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: integer('status').notNull().default(0),
    priority: integer('priority').notNull().default(0),
    progress: integer('progress').notNull().default(0),
    totalItems: integer('total_items').default(0),
    processedItems: integer('processed_items').default(0),
    result: jsonb('result').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const workflowTemplates = pgTable('workflow_templates', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    groupName: text('group_name').default('default'),
    templateJson: jsonb('template_json').notNull(),
    inputParameters: jsonb('input_parameters').$type<unknown[]>().notNull().default([]),
    providerType: integer('provider_type').notNull().default(100),
    userId: uuid('user_id'),
    isPublic: boolean('is_public').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const userCheckins = pgTable('user_checkins', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    checkinDate: date('checkin_date').notNull(),
    reward: bigint('reward', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});


export const healthLogs = pgTable('health_logs', {
    id: serial('id').primaryKey(),
    channelId: integer('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    status: integer('status').notNull(),
    latency: integer('latency'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const dailyStats = pgTable('daily_stats', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    statDate: date('stat_date').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
    totalCost: bigint('total_cost', { mode: 'number' }).notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
});

export const modelStats = pgTable('model_stats', {
    id: serial('id').primaryKey(),
    modelName: text('model_name').notNull(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    requestCount: integer('request_count').notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
    totalCost: bigint('total_cost', { mode: 'number' }).notNull().default(0),
    avgTokensPerRequest: integer('avg_tokens_per_request').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
});


export const rateLimits = pgTable('rate_limits', {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
});

export const responseCache = pgTable('response_cache', {
    hash: text('hash').primaryKey(),
    modelName: text('model_name').notNull(),
    response: jsonb('response').$type<unknown>(),
    usage: jsonb('usage').$type<unknown>(),
    createdBy: integer('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
});

export const semanticCache = pgTable('semantic_cache', {
    id: serial('id').primaryKey(),
    modelName: text('model_name').notNull(),
    promptHash: text('prompt_hash').notNull(),
    prompt: text('prompt'),
    embedding: text('embedding'),
    response: jsonb('response').$type<unknown>(),
    createdBy: integer('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const apiFiles = pgTable('api_files', {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull(),
    tokenId: integer('token_id'),
    object: text('object').default('file'),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    filename: text('filename').notNull(),
    purpose: text('purpose').notNull(),
    status: text('status').default('processed'),
    statusDetails: text('status_details'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const apiBatches = pgTable('api_batches', {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull(),
    tokenId: integer('token_id'),
    endpoint: text('endpoint'),
    inputFileId: text('input_file_id'),
    completionWindow: text('completion_window').default('24h'),
    status: text('status').notNull().default('validating'),
    outputFileId: text('output_file_id'),
    errorFileId: text('error_file_id'),
    requestCounts: jsonb('request_counts').$type<{ total: number; completed: number; failed: number }>().default({ total: 0, completed: 0, failed: 0 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    errors: jsonb('errors').$type<unknown[]>(),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    inProgressAt: timestamp('in_progress_at', { withTimezone: true }),
    finalizingAt: timestamp('finalizing_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    cancellingAt: timestamp('cancelling_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const mjTasks = pgTable('mj_tasks', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    uuid: text('uuid').notNull(),
    action: text('action').notNull(),
    prompt: text('prompt'),
    status: text('status').notNull().default('SUBMITTED'),
    progress: text('progress').default('0%'),
    imageUrl: text('image_url'),
    failReason: text('fail_reason'),
    finishTime: timestamp('finish_time', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const paymentOrders = pgTable('payment_orders', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    amount: integer('amount').notNull(),
    paymentMethod: text('payment_method').notNull(),
    orderType: text('order_type').notNull().default('topup'),
    targetType: text('target_type'),
    targetId: integer('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    status: integer('status').notNull().default(0),
    transactionId: text('transaction_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const idempotencyKeys = pgTable('idempotency_keys', {
    keyHash: text('key_hash').primaryKey(),
    userId: integer('user_id').notNull(),
    responseCode: integer('response_code'),
    responseBody: jsonb('response_body').$type<unknown>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const logDetails = pgTable('log_details', {
    logId: integer('log_id').primaryKey(),
    logCreatedAt: timestamp('log_created_at', { withTimezone: true }),
    requestBody: text('request_body'),
    responseBody: text('response_body'),
});

export const budgetAlerts = pgTable('budget_alerts', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    username: text('username').notNull(),
    quota: bigint('quota', { mode: 'number' }).notNull(),
    usedQuota: bigint('used_quota', { mode: 'number' }).notNull(),
    usagePercent: decimal('usage_percent', { precision: 5, scale: 4 }).notNull(),
    alertLevel: text('alert_level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    username: text('username').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const userSubscriptions = pgTable('user_subscriptions', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    packageId: integer('package_id').notNull().references(() => packages.id, { onDelete: 'cascade' }),
    status: integer('status').notNull().default(1),
    startTime: timestamp('start_time', { withTimezone: true }).defaultNow(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    quotaGranted: bigint('quota_granted', { mode: 'number' }).default(0),
    quotaUsed: bigint('quota_used', { mode: 'number' }).default(0),
    lastResetAt: timestamp('last_reset_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const inviteCodes = pgTable('invite_codes', {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    giftQuota: bigint('gift_quota', { mode: 'number' }).notNull().default(0),
    status: integer('status').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const announcements = pgTable('announcements', {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    tag: text('tag'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const userAff = pgTable('user_aff', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    reward: bigint('reward', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const userAffRewards = pgTable('user_aff_rewards', {
    id: serial('id').primaryKey(),
    referrerId: integer('referrer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refereeId: integer('referee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    reward: bigint('reward', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});


export const oauthAccounts = pgTable('oauth_accounts', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const customOAuthProviders = pgTable('custom_oauth_providers', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    issuer: text('issuer'),
    discoveryUrl: text('discovery_url'),
    clientId: text('client_id'),
    clientSecret: text('client_secret'),
    authorizationEndpoint: text('authorization_endpoint'),
    tokenEndpoint: text('token_endpoint'),
    userinfoEndpoint: text('userinfo_endpoint'),
    jwksUri: text('jwks_uri'),
    scopes: jsonb('scopes').$type<string[]>().default([]),
    enabled: boolean('enabled').notNull().default(true),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const loginAttempts = pgTable('login_attempts', {
    id: serial('id').primaryKey(),
    username: text('username').notNull(),
    ipAddress: text('ip_address'),
    success: boolean('success').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const twoFactorLoginChallenges = pgTable('two_factor_login_challenges', {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const schema = {
    channels,
    logs,
    'models-meta': modelMetadata,
    options,
    organizations,
    packages,
    'rate-limits': rateLimitRules,
    redemptions,
    sessions,
    'token-cache': tokenCache,
    tasks,
    tokens,
    'user-checkins': userCheckins,
    'user-groups': userGroups,
    'user-quota-cache': userQuotaCache,
    users,
    vendors,
    'workflow-templates': workflowTemplates,
    'health-logs': healthLogs,
    'daily-stats': dailyStats,
    'model-stats': modelStats,    'rate-limits-table': rateLimits,    'response-cache': responseCache,    'semantic-cache': semanticCache,    'api-files': apiFiles,    'api-batches': apiBatches,    'mj-tasks': mjTasks,    'payment-orders': paymentOrders,    'idempotency-keys': idempotencyKeys,    'log-details': logDetails,    'budget-alerts': budgetAlerts,    'audit-logs': auditLogs,    'user-subscriptions': userSubscriptions,
    'invite-codes': inviteCodes,
    announcements,
    'user-aff': userAff,
    'user-aff-rewards': userAffRewards,
    oauthAccounts,
    'custom-oauth-providers': customOAuthProviders,
    loginAttempts,
    'two-factor-login-challenges': twoFactorLoginChallenges,
};

export type DatabaseSchema = typeof schema;
