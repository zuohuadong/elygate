export interface UserRecord {
    id: number;
    username: string;
    group: string;
    role: number;
    quota: number;
    status: number;
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
}

export interface UsageInfo {
    promptTokens: number;
    completionTokens: number;
}

export interface BillingContext {
    userId: number;
    tokenId: number;
    channelId: number;
    modelName: string;
    promptTokens: number;
    completionTokens: number;
    userGroup: string;
    isStream: boolean;
}
