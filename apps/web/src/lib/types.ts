export interface User {
    id: number;
    username: string;
    quota: number;
    usedQuota: number;
    role: number;
    group: string;
    status: number;
    currency?: string;
    createdAt: string;
}

export interface Channel {
    id: number;
    type: number;
    name: string;
    base_url: string;
    baseUrl?: string; // Frontend often uses camelCase
    key: string;
    models: string[] | string;
    model_mapping?: Record<string, string>;
    modelMapping?: Record<string, string>;
    weight: number;
    status: number;
    response_time?: number;
    test_at?: string;
    created_at?: string;
}

export interface Token {
    id: number;
    user_id: number;
    name: string;
    key: string;
    status: number;
    remain_quota: number;
    remainQuota?: number;
    models: string[] | string;
    created_at?: string;
    expired_at?: number;
    expiredAt?: number;
}

export interface Redemption {
    id: number;
    name: string;
    key: string;
    quota: number;
    count: number;
    used_count?: number;
    status: number;
    created_at: string;
}

export interface Log {
    id: number;
    user_id: number;
    token_name?: string;
    type: string;
    created_at: string;
    model_name: string;
    prompt_tokens: number;
    completion_tokens: number;
    quota_cost: number;
    status_code: number;
    error_message?: string;
    ip: string;
}

export interface DashboardStats {
    usedQuota: number;
    todayQuota: number;
    totalUsers: number;
    activeChannels: number;
}

export interface DashboardError {
    title: string;
    ip: string;
    count: number;
}

export interface UsageTrend {
    label: string;
    prompt_tokens: number;
    completion_tokens: number;
}
