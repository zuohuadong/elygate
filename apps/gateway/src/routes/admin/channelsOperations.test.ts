import { describe, expect, test } from 'bun:test';

const OPENAI_CHANNEL = 1;
const GEMINI_CHANNEL = 24;

const {
    normalizeChannelModels,
    parseUpstreamModels,
    reconcileChannelModelSync,
} = await import('./channelModelSync');
const { buildCopiedChannelValues } = await import('./channelOperations');

describe('admin channel operations helpers', () => {
    test('parses OpenAI-compatible, Gemini, and array model list payloads', () => {
        expect(parseUpstreamModels({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4o-mini' }] }, OPENAI_CHANNEL)).toEqual([
            'gpt-4.1',
            'gpt-4o-mini',
        ]);
        expect(parseUpstreamModels({ models: [{ name: 'models/gemini-2.5-pro' }, { displayName: 'gemini-live' }] }, GEMINI_CHANNEL)).toEqual([
            'gemini-2.5-pro',
            'gemini-live',
        ]);
        expect(parseUpstreamModels([{ name: 'custom-a' }, { id: 'custom-b' }], OPENAI_CHANNEL)).toEqual([
            'custom-a',
            'custom-b',
        ]);
    });

    test('normalizes stored model arrays before copy and sync comparisons', () => {
        expect(normalizeChannelModels('["a","b",3]')).toEqual(['a', 'b']);
        expect(normalizeChannelModels(['x', '', 'y'])).toEqual(['x', 'y']);
        expect(normalizeChannelModels('bad json')).toEqual([]);
    });

    test('cleans stale aliases and generates safe aliases for new upstream models', () => {
        const result = reconcileChannelModelSync({
            currentModels: ['old-model', 'Qwen/Qwen-Image'],
            upstreamModels: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen-Image', 'text-embedding-3-large'],
            modelMapping: {
                keep: 'Qwen/Qwen-Image',
                stale: 'old-model',
            },
        });

        expect(result.removedModels).toEqual(['old-model']);
        expect(result.newModels).toEqual(['deepseek-ai/DeepSeek-V3', 'text-embedding-3-large']);
        expect(result.brokenAliases).toEqual(['stale']);
        expect(result.modelMapping).toMatchObject({
            keep: 'Qwen/Qwen-Image',
            'DeepSeek-V3': 'deepseek-ai/DeepSeek-V3',
        });
        expect(result.generatedAliases).toEqual({ 'DeepSeek-V3': 'deepseek-ai/DeepSeek-V3' });
        expect(result.modelMapping).not.toHaveProperty('text-embedding-3-large');
    });

    test('builds disabled channel copy payload while preserving routing metadata', () => {
        const copy = buildCopiedChannelValues({
            name: 'primary',
            type: 1,
            key: 'encrypted-key',
            baseUrl: 'https://upstream.example.test',
            models: ['gpt-4.1'],
            modelMapping: { alias: 'gpt-4.1' },
            priority: 10,
            weight: 2,
            status: 1,
            keyStrategy: 1,
            keyStatus: { key: 'active' },
            priceRatio: '1.2',
            keyConcurrencyLimit: 3,
            endpointType: 'chat',
            groups: ['default', 'vip'],
        });

        expect(copy).toEqual({
            name: '[Copy] primary',
            type: 1,
            key: 'encrypted-key',
            baseUrl: 'https://upstream.example.test',
            models: ['gpt-4.1'],
            modelMapping: { alias: 'gpt-4.1' },
            priority: 10,
            weight: 2,
            status: 3,
            keyStrategy: 1,
            keyStatus: { key: 'active' },
            priceRatio: '1.2',
            keyConcurrencyLimit: 3,
            endpointType: 'chat',
            groups: ['default', 'vip'],
        });
    });
});
