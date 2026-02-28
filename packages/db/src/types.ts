// Native SQL Model Type Definitions
// These interfaces replace the former Drizzle Query types, used as manual results assertions.

export interface User {
    id: number;
    username: string;
    passwordHash: string;
    role: number;
    quota: number;        // Unit: 0.001 cent (0.001 cent = 1)
    usedQuota: number;
    group: string;        // e.g., 'vip', 'default'
    status: number;       // 1-Active, 2-Banned
    createdAt: Date;
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
    status: number;       // 1-Active, 2-Disabled
    testAt: Date | null;
    createdAt: Date;
}

export interface Token {
    id: number;
    userId: number;
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
    modelName: string;
    quotaCost: number;
    promptTokens: number;
    completionTokens: number;
    isStream: boolean;
    createdAt: Date;
}
