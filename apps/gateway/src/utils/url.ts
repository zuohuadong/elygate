import { ChannelType } from '../providers/types';
import type { ChannelConfig } from '../types';

/**
 * Build upstream API URL based on channel config and endpoint type.
 * Replaces 6+ duplicated URL-building blocks across the codebase.
 */
export function buildUpstreamUrl(
    config: ChannelConfig,
    model: string,
    endpointType: string,
    stream = false
): string {
    let base = config.baseUrl.replace(/\/+$/, '');

    // Strip trailing /v1 to avoid duplication
    if (base.endsWith('/v1')) {
        base = base.slice(0, -3);
    }

    // Native Gemini endpoint
    if (config.type === ChannelType.GEMINI && (endpointType === 'chat' || endpointType === 'native-gemini')) {
        const endpoint = stream ? ':streamGenerateContent?alt=sse' : ':generateContent';
        return `${base}/v1beta/models/${model}${endpoint}`;
    }

    // Dakka Draw API endpoint — different model families use different endpoints
    if (config.type === ChannelType.DAKKA) {
        if (model.startsWith('nano-banana')) {
            return `${base}/v1/draw/nano-banana`;
        }
        if (model.startsWith('veo')) {
            return `${base}/v1/video/veo`;
        }
        return `${base}/v1/draw/completions`;
    }

    // Channel-level endpoint override: if channel has a specific endpointType configured,
    // use it instead of the request's endpointType. This allows admins to configure
    // video-only channels, image-only channels, etc. without hardcoding model names.
    const effectiveEndpoint = (config.endpointType && config.endpointType !== 'auto')
        ? config.endpointType
        : endpointType;

    // Auto-detect non-v1 version paths (e.g. Zhipu /v4, DeepSeek /v1beta)
    let vPrefix = '/v1';
    if (base.match(/\/v[2-9](\.[0-9]+)?$/) || base.endsWith('v1beta')) {
        vPrefix = '';
    }

    switch (effectiveEndpoint) {
        case 'chat': return `${base}${vPrefix}/chat/completions`;
        case 'embeddings': return `${base}${vPrefix}/embeddings`;
        case 'images': return `${base}${vPrefix}/images/generations`;
        case 'moderations': return `${base}${vPrefix}/moderations`;
        case 'rerank': return `${base}${vPrefix}/rerank`;
        case 'video': return `${base}${vPrefix}/video/submit`;
        case 'responses': return `${base}${vPrefix}/responses`;
        default: return `${base}/v1/${effectiveEndpoint}`;
    }
}

/**
 * Build URL for fetching model list from upstream provider.
 * Replaces 4+ duplicated blocks in admin.ts.
 */
export function buildModelsUrl(baseUrl: string, channelType: number): string {
    const base = baseUrl.replace(/\/+$/, '');

    if (channelType === ChannelType.GEMINI) {
        if (base.endsWith('/v1beta')) {
            return `${base}/models`;
        }
        if (base.includes('/v1beta/models')) {
            return base;
        }
        return `${base}/v1beta/models`;
    }

    // OpenAI-compatible endpoints
    if (base.endsWith('/v1/models') || base.endsWith('/v1/models/')) {
        return base;
    }
    if (base.match(/\/v[1-9](\.[0-9]+)?$/) || base.endsWith('v1beta')) {
        return `${base}/models`;
    }
    return `${base}/v1/models`;
}

/**
 * Build upstream test URL for channel connectivity tests.
 * Handles smart URL deduplication for /v1 prefix.
 */
export function buildTestUrl(
    baseUrl: string,
    channelType: number,
    model: string
): string {
    const base = baseUrl.replace(/\/+$/, '');

    if (channelType === ChannelType.GEMINI) {
        if (base.endsWith('/v1beta')) {
            return `${base}/models/${model}:generateContent`;
        }
        if (base.includes('/v1beta/models')) {
            const root = base.split('/models/')[0];
            return base.includes(':generateContent') ? base : `${root}/models/${model}:generateContent`;
        }
        return `${base}/v1beta/models/${model}:generateContent`;
    }

    // Dakka Draw API
    if (channelType === ChannelType.DAKKA) {
        if (model.startsWith('nano-banana')) {
            return `${base}/v1/draw/nano-banana`;
        }
        return `${base}/v1/draw/completions`;
    }

    // OpenAI-compatible
    if (base.endsWith('/v1/chat/completions')) {
        return base;
    }
    if (base.endsWith('/v1') || base.match(/\/v[2-9](\.[0-9]+)?$/) || base.endsWith('v1beta')) {
        return `${base}/chat/completions`;
    }
    return `${base}/v1/chat/completions`;
}
