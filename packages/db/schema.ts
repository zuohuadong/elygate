import {
    pgTable,
    serial,
    text,
    integer,
    timestamp,
    jsonb,
    boolean,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// User Roles: 1-Regular User, 10-Administrator (Compatible with New-API)
// Status: 1-Active, 2-Banned

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    quota: integer('quota').notNull().default(0), // Remaining quota
    usedQuota: integer('used_quota').notNull().default(0), // Consumed quota
    role: integer('role').notNull().default(1),
    group: text('group').notNull().default('default'), // User group for multi-ratio billing
    status: integer('status').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const channels = pgTable('channels', {
    id: serial('id').primaryKey(),
    type: integer('type').notNull().default(1), // 1-OpenAI, 14-Anthropic, 23-Gemini, etc.
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    key: text('key').notNull(), // Supports multiple keys separated by \n
    models: jsonb('models').notNull().default('[]'), // List of supported models
    modelMapping: jsonb('model_mapping').notNull().default('{}'), // e.g. {"gpt-4": "gpt4-turbo"}
    weight: integer('weight').notNull().default(1), // Load balancing weight
    status: integer('status').notNull().default(1), // 1-Enabled, 2-Disabled, 3-Auto-disabled
    testAt: timestamp('test_at'),
    responseTime: integer('response_time').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const tokens = pgTable('tokens', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull().unique(), // sk-xxxx
    name: text('name').notNull(),
    status: integer('status').notNull().default(1), // 1-Enabled, 2-Disabled
    remainQuota: integer('remain_quota').notNull().default(0), // Token-specific quota (-1 for unlimited, capped by user quota)
    usedQuota: integer('used_quota').notNull().default(0),
    expiredAt: timestamp('expired_at'), // -1/null for never expired
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
    keyIdx: uniqueIndex('idx_token_key').on(table.key)
}));

export const logs = pgTable('logs', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenId: integer('token_id').references(() => tokens.id, { onDelete: 'set null' }),
    channelId: integer('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    modelName: text('model_name').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    quotaCost: integer('quota_cost').notNull().default(0),
    isStream: boolean('is_stream').notNull().default(false),
    type: integer('type').notNull().default(1), // 1-Consumption, 2-Top-up
    createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
    userIdx: index('idx_log_user_id').on(table.userId),
    createdAtIdx: index('idx_log_created_at').on(table.createdAt)
}));

// -- Relations --
export const usersRelations = relations(users, ({ many }) => ({
    tokens: many(tokens),
    logs: many(logs),
}));

export const tokensRelations = relations(tokens, ({ one, many }) => ({
    user: one(users, {
        fields: [tokens.userId],
        references: [users.id],
    }),
    logs: many(logs),
}));

export const channelsRelations = relations(channels, ({ many }) => ({
    logs: many(logs),
}));

export const logsRelations = relations(logs, ({ one }) => ({
    user: one(users, {
        fields: [logs.userId],
        references: [users.id],
    }),
    token: one(tokens, {
        fields: [logs.tokenId],
        references: [tokens.id],
    }),
    channel: one(channels, {
        fields: [logs.channelId],
        references: [channels.id],
    }),
}));
