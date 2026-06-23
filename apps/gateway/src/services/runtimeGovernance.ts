import type { TokenRecord, UserRecord } from '../types';

export type RuntimeGovernanceInput = {
    readonly model: string;
    readonly endpointType: string;
    readonly user: UserRecord;
    readonly token: TokenRecord;
    readonly userGroup: string;
    readonly requestedQuota: number;
    readonly ip?: string;
    readonly ua?: string;
    readonly externalTaskId?: string;
    readonly externalUserId?: string;
    readonly externalWorkspaceId?: string;
    readonly externalFeatureType?: string;
};

export type RuntimeGovernanceUsage = {
    readonly actualQuota: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly cachedTokens?: number;
    readonly statusCode?: number;
    readonly channelId?: number;
    readonly traceId?: string;
    readonly isStream?: boolean;
};

export type RuntimeGovernanceSession = {
    readonly recordUsage: (usage: RuntimeGovernanceUsage) => Promise<void>;
};

export type RuntimeGovernanceGuard = (input: RuntimeGovernanceInput) => Promise<RuntimeGovernanceSession | null | undefined>;

let currentGuard: RuntimeGovernanceGuard | null = null;

export function setRuntimeGovernanceGuard(guard: RuntimeGovernanceGuard | null): void {
    currentGuard = guard;
}

export async function enforceRuntimeGovernanceGuard(input: RuntimeGovernanceInput): Promise<RuntimeGovernanceSession | null> {
    if (!currentGuard) return null;
    return await currentGuard(input) ?? null;
}

export async function recordRuntimeGovernanceUsage(
    session: RuntimeGovernanceSession | null | undefined,
    usage: RuntimeGovernanceUsage,
): Promise<void> {
    if (!session) return;
    await session.recordUsage(usage);
}
