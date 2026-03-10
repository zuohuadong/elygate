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
export enum ChannelType {
    OPENAI = 1,
    AZURE = 8,
    ANTHROPIC = 14,
    BAIDU = 15,
    ZEN = 16,
    ALI = 17,
    XUNFEI = 18,
    GEMINI = 23,
    MIDJOURNEY = 24,
    JINA = 25,
    SUNO = 26,
    DEEPSEEK = 31,
    CF_WORKER = 33,
    FLUX = 34,
    UDIO = 35,
    NVIDIA = 41
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
