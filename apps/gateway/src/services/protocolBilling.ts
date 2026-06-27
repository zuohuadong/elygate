import type { BillingContext, UsageInfo } from '../types';

export type ProtocolBillingEndpoint =
    | 'chat'
    | 'embeddings'
    | 'images'
    | 'audio'
    | 'audio/speech'
    | 'audio/transcriptions'
    | 'audio/translations'
    | 'moderations'
    | 'rerank'
    | 'video'
    | 'responses'
    | 'native-gemini';

type UsageLike = Partial<UsageInfo> & {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    cached_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
    input_tokens_details?: { cached_tokens?: unknown };
};

function positiveNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function recordValue(input: unknown, key: string): unknown {
    return input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
}

export function estimateProtocolBillingUsage(input: {
    endpointType: ProtocolBillingEndpoint;
    requestBody: unknown;
    extractedUsage?: UsageLike;
    binaryResponse?: boolean;
}): Required<UsageInfo> {
    if (input.binaryResponse) {
        const audioInput = recordValue(input.requestBody, 'input');
        const promptTokens = input.endpointType.startsWith('audio')
            ? (typeof audioInput === 'string' ? Math.max(audioInput.length, 1) : 1)
            : 1000;
        return { promptTokens, completionTokens: 0, cachedTokens: 0 };
    }

    const usage = input.extractedUsage || {};
    let promptTokens = positiveNumber(usage.promptTokens) || positiveNumber(usage.prompt_tokens) || positiveNumber(usage.input_tokens);
    const completionTokens = positiveNumber(usage.completionTokens) || positiveNumber(usage.completion_tokens) || positiveNumber(usage.output_tokens);
    const cachedTokens = positiveNumber(usage.cachedTokens)
        || positiveNumber(usage.cached_tokens)
        || positiveNumber(usage.prompt_tokens_details?.cached_tokens)
        || positiveNumber(usage.input_tokens_details?.cached_tokens);

    if (input.endpointType === 'images' && promptTokens === 0 && completionTokens === 0) {
        promptTokens = positiveNumber(recordValue(input.requestBody, 'n')) || 1;
    }

    return { promptTokens, completionTokens, cachedTokens };
}

function serializeBody(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

export function buildProtocolBillingContext(input: {
    userId: number;
    tokenId: number;
    channelId: number;
    modelName: string;
    userGroup: string;
    endpointType: ProtocolBillingEndpoint;
    requestBody: unknown;
    extractedUsage?: UsageLike;
    binaryResponse?: boolean;
    requestBodyForLog?: string;
    responseBodyForLog?: unknown;
    isStream?: boolean;
    isPackageFree?: boolean;
    statusCode?: number;
    traceId?: string;
    orgId?: number;
    ip?: string;
    ua?: string;
    externalTaskId?: string;
    externalUserId?: string;
    externalWorkspaceId?: string;
    externalFeatureType?: string;
}): BillingContext {
    const usage = estimateProtocolBillingUsage({
        endpointType: input.endpointType,
        requestBody: input.requestBody,
        extractedUsage: input.extractedUsage,
        binaryResponse: input.binaryResponse,
    });

    return {
        userId: input.userId,
        tokenId: input.tokenId,
        channelId: input.channelId,
        modelName: input.modelName,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedTokens: usage.cachedTokens,
        userGroup: input.userGroup,
        isStream: input.isStream || false,
        isPackageFree: input.isPackageFree,
        statusCode: input.statusCode,
        traceId: input.traceId,
        orgId: input.orgId,
        ip: input.ip,
        ua: input.ua,
        externalTaskId: input.externalTaskId,
        externalUserId: input.externalUserId,
        externalWorkspaceId: input.externalWorkspaceId,
        externalFeatureType: input.externalFeatureType,
        requestBody: input.requestBodyForLog,
        responseBody: input.responseBodyForLog === undefined ? undefined : serializeBody(input.responseBodyForLog),
    };
}
