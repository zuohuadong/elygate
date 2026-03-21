import { ProviderHandler } from './types';

export const DeepSeekApiHandler: ProviderHandler = {
    transformRequest,
    transformResponse,
    extractUsage,
    buildHeaders
};

function buildHeaders(apiKey: string): Headers {
        return new Headers({
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        });
    }

function transformRequest(body: Record<string, any>, model: string): Record<string, any> {
        if (model.includes('-thinking')) {
            const [baseModel] = model.split('-thinking');
            return {
                ...body,
                model: baseModel,
                reasoning_effort: 'high'
            };
        }

        if (model.includes('-reasoning')) {
            const [baseModel, effort] = model.split('-reasoning-');
            return {
                ...body,
                model: baseModel,
                reasoning_effort: effort || 'medium'
            };
        }

        return { ...body, model };
    }

function transformResponse(data: Record<string, any>): Record<string, any> {
        if (data.choices && data.choices[0]?.message?.reasoning_content) {
            const message: Record<string, any> = {
                ...data.choices[0].message
            };
            // Keep original reasoning_content and content as separate fields
            return {
                ...data,
                choices: [{
                    ...data.choices[0],
                    message
                }]
            };
        }
        return data;
    }

function extractUsage(data: Record<string, any>): { promptTokens: number; completionTokens: number } {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0
        };
    }

