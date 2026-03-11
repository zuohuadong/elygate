export interface UserRecord {
    id: number;
    username: string;
    group: string;
    role: number;
    quota: number;
    usedQuota: number;
    status: number;
    currency?: string;
    activePackages?: any[]; // [{ models, defaultRateLimitId, modelRateLimits }]
}

export interface UserGroupPolicy {
    key: string;
    name: string;
    allowedChannelTypes: number[];
    deniedChannelTypes: number[];
    allowedModels: string[];
    deniedModels: string[];
    allowedPackages: number[];
}

export interface TokenRecord {
    id: number;
    name: string;
    key: string;
    remainQuota: number;
    usedQuota: number;
    status: number;
    expiredAt: Date | null;
    models: string[];
    subnet: string;
    rateLimit: number;
}
// ChannelType values matching New-API/One-API spec — defined in providers/types.ts
export { ChannelType } from './providers/types';

export interface ChannelConfig {
    id: number;
    type: number;
    name: string;
    baseUrl: string;
    key: string;
    models: string[] | string;
    modelMapping: Record<string, string>;
    weight: number;
    priority: number;
    groups: string[];
    status: number;
    keyConcurrencyLimit: number;
    keyStrategy: number;         // 0=Load balance, 1=Sequential
    keyStatus: Record<string, string>; // { "sk-xxx": "exhausted" | "active" }
}

export interface UsageInfo {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
}

export interface BillingContext {
    userId: number;
    tokenId: number;
    channelId: number;
    modelName: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    userGroup: string;
    isStream: boolean;
    isPackageFree?: boolean;
}
