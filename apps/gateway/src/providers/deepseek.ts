import { ProviderHandler } from './types';

export class DeepSeekApiHandler implements ProviderHandler {
    buildHeaders(apiKey: string): Headers {
        return new Headers({
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        });
    }

    transformRequest(body: Record<string, any>, model: string): any {
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

    transformResponse(data: any): any {
        if (data.choices && data.choices[0]?.message?.reasoning_content) {
            return {
                ...data,
                choices: [{
                    ...data.choices[0],
                    message: {
                        ...data.choices[0].message,
                        content: data.choices[0].message.reasoning_content + '\n\n' + data.choices[0].message.content
                    }
                }]
            };
        }
        return data;
    }

    extractUsage(data: any): { promptTokens: number; completionTokens: number } {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0
        };
    }
}
