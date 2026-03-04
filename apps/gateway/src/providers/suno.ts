import { ProviderHandler } from './types';

export class SunoApiHandler implements ProviderHandler {
    buildHeaders(apiKey: string): Headers {
        return new Headers({
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        });
    }

    transformRequest(body: Record<string, any>, model: string): any {
        if (body.prompt) {
            return {
                prompt: body.prompt,
                make_instrumental: body.make_instrumental || false,
                mv: body.mv || 'chirp-v3-0',
                wait_audio: body.wait_audio || false
            };
        }
        
        return {
            prompt: body.messages?.[body.messages.length - 1]?.content || '',
            make_instrumental: body.make_instrumental || false,
            mv: model.includes('v3.5') ? 'chirp-v3-5' : 'chirp-v3-0',
            wait_audio: body.wait_audio || false
        };
    }

    transformResponse(data: any): any {
        if (Array.isArray(data)) {
            return {
                id: `suno-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'suno',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: JSON.stringify(data.map((song: any) => ({
                            id: song.id,
                            title: song.title,
                            image_url: song.image_url,
                            audio_url: song.audio_url,
                            video_url: song.video_url,
                            created_at: song.created_at,
                            status: song.status,
                            model_name: song.model_name
                        })))
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };
        }
        
        return {
            id: `suno-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'suno',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: JSON.stringify(data)
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        };
    }

    extractUsage(data: any): { promptTokens: number; completionTokens: number } {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0
        };
    }
}
