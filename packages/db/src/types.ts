// Native SQL Model Type Definitions
// These interfaces replace the former Drizzle Query types, used as manual results assertions.

export interface User {
    id: number;
    username: string;
    passwordHash: string;
    role: number;
    orgId: number | null;
    quota: number;        // Unit: 0.001 cent (0.001 cent = 1)
    usedQuota: number;
    group: string;        // e.g., 'vip', 'default'
    status: number;       // 1-Active, 2-Bans
    currency: 'USD' | 'RMB';
    createdAt: Date;
}

export interface Organization {
    id: number;
    slug: string | null;
    name: string;
    billingEmail: string | null;
    quota: number;
    usedQuota: number;
    allowedModels: string[];
    deniedModels: string[];
    allowedSubnets: string;
    quotaAlarmThreshold: number;
    status: number;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export interface Channel {
    id: number;
    type: number;         // 1-OpenAI, 14-Anthropic, etc.
    name: string;
    baseUrl: string | null;
    key: string;          // Supports multi-keys separated by \n
    models: any;          // JSONB or string format
    modelMapping: any;    // JSONB: Dictionary for model name mapping
    weight: number;
    keyConcurrencyLimit: number;
    status: number;       // 1-Active, 2-Disabled
    testAt: Date | null;
    createdAt: Date;
}

export interface Token {
    id: number;
    userId: number;
    orgId: number | null;
    name: string;
    key: string;          // sk-xxxx
    status: number;
    remainQuota: number;  // -1 for unlimited
    usedQuota: number;
    expiredAt: Date | null;
    createdAt: Date;
}

export interface Log {
    id: number;
    userId: number;
    tokenId: number | null;
    channelId: number | null;
    orgId: number | null;
    modelName: string;
    quotaCost: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    traceId: string | null;
    isStream: boolean;
    createdAt: Date;
}

export interface RateLimitRule {
    id: number;
    name: string;
    rpm: number;
    rph: number;
    concurrent: number;
    createdAt: Date;
}

export interface Package {
    id: number;
    name: string;
    description: string;
    price: number | string; // DECIMAL handles as string/number in JS
    durationDays: number;
    models: any; // JSONB
    defaultRateLimitId: number | null;
    modelRateLimits: any; // JSONB
    isPublic: boolean;
    addedBy: number | null;
    updatedAt: Date;
    createdAt: Date;
}

export interface UserSubscription {
    id: number;
    userId: number;
    packageId: number;
    startTime: Date;
    endTime: Date;
    status: number; // 1: active, 2: expired, 3: disabled
    createdAt: Date;
    updatedAt: Date;
}
