import { describe, expect, test } from 'bun:test';

const { buildProtocolBillingContext, estimateProtocolBillingUsage } = await import('./protocolBilling');

describe('protocol billing/logging compatibility helpers', () => {
    test('normalizes chat, responses, embeddings, and rerank usage payloads', () => {
        expect(estimateProtocolBillingUsage({
            endpointType: 'chat',
            requestBody: { messages: [{ role: 'user', content: 'hi' }] },
            extractedUsage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } },
        })).toEqual({ promptTokens: 10, completionTokens: 5, cachedTokens: 3 });

        expect(estimateProtocolBillingUsage({
            endpointType: 'responses',
            requestBody: { input: 'hi' },
            extractedUsage: { input_tokens: 11, output_tokens: 6, input_tokens_details: { cached_tokens: 4 } },
        })).toEqual({ promptTokens: 11, completionTokens: 6, cachedTokens: 4 });

        expect(estimateProtocolBillingUsage({
            endpointType: 'embeddings',
            requestBody: { input: ['a', 'b'] },
            extractedUsage: { promptTokens: 7, completionTokens: 0 },
        })).toEqual({ promptTokens: 7, completionTokens: 0, cachedTokens: 0 });

        expect(estimateProtocolBillingUsage({
            endpointType: 'rerank',
            requestBody: { query: 'q', documents: ['a'] },
            extractedUsage: { prompt_tokens: 9 },
        })).toEqual({ promptTokens: 9, completionTokens: 0, cachedTokens: 0 });
    });

    test('applies image and binary protocol fallbacks when upstream usage is absent', () => {
        expect(estimateProtocolBillingUsage({
            endpointType: 'images',
            requestBody: { prompt: 'draw', n: 3 },
            extractedUsage: {},
        })).toEqual({ promptTokens: 3, completionTokens: 0, cachedTokens: 0 });

        expect(estimateProtocolBillingUsage({
            endpointType: 'audio/speech',
            requestBody: { input: 'speak' },
            binaryResponse: true,
        })).toEqual({ promptTokens: 5, completionTokens: 0, cachedTokens: 0 });

        expect(estimateProtocolBillingUsage({
            endpointType: 'video',
            requestBody: { prompt: 'clip' },
            binaryResponse: true,
        })).toEqual({ promptTokens: 1000, completionTokens: 0, cachedTokens: 0 });
    });

    test('builds the billAndLog payload with audit metadata and serialized bodies', () => {
        const ctx = buildProtocolBillingContext({
            userId: 10,
            tokenId: 20,
            channelId: 30,
            modelName: 'gpt-test',
            userGroup: 'default',
            endpointType: 'responses',
            requestBody: { input: 'hello' },
            extractedUsage: { input_tokens: 8, output_tokens: 2 },
            statusCode: 202,
            traceId: 'trace_test',
            orgId: 40,
            ip: '127.0.0.1',
            ua: 'test-agent',
            externalTaskId: 'task_1',
            externalUserId: 'user_1',
            externalWorkspaceId: 'workspace_1',
            externalFeatureType: 'feature_1',
            responseBodyForLog: { id: 'resp_1', usage: { input_tokens: 8, output_tokens: 2 } },
        });

        expect(ctx).toMatchObject({
            userId: 10,
            tokenId: 20,
            channelId: 30,
            modelName: 'gpt-test',
            promptTokens: 8,
            completionTokens: 2,
            cachedTokens: 0,
            userGroup: 'default',
            isStream: false,
            statusCode: 202,
            traceId: 'trace_test',
            orgId: 40,
            ip: '127.0.0.1',
            ua: 'test-agent',
            externalTaskId: 'task_1',
            externalUserId: 'user_1',
            externalWorkspaceId: 'workspace_1',
            externalFeatureType: 'feature_1',
        });
        expect(ctx.responseBody).toBe('{"id":"resp_1","usage":{"input_tokens":8,"output_tokens":2}}');
    });
});
