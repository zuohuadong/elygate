import { describe, test, expect } from 'bun:test';
import { DeepSeekApiHandler } from '../src/providers/deepseek';
import { SunoApiHandler } from '../src/providers/suno';

describe('DeepSeek Provider Tests', () => {
    const handler = DeepSeekApiHandler;

    test('should build correct headers', () => {
        const headers = handler.buildHeaders('test-api-key');
        
        expect(headers.get('Authorization')).toBe('Bearer test-api-key');
        expect(headers.get('Content-Type')).toBe('application/json');
    });

    test('should transform normal request', () => {
        const body = {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Hello' }],
            temperature: 0.7
        };
        
        const transformed = handler.transformRequest(body, 'deepseek-chat');
        
        expect(transformed.model).toBe('deepseek-chat');
        expect(transformed.messages).toEqual(body.messages);
        expect(transformed.temperature).toBe(0.7);
    });

    test('should transform thinking mode request', () => {
        const body = {
            model: 'deepseek-reasoner-thinking',
            messages: [{ role: 'user', content: 'Solve this problem' }]
        };
        
        const transformed = handler.transformRequest(body, 'deepseek-reasoner-thinking');
        
        expect(transformed.model).toBe('deepseek-reasoner');
        expect(transformed.reasoning_effort).toBe('high');
    });

    test('should transform reasoning mode request', () => {
        const body = {
            model: 'deepseek-chat-reasoning-medium',
            messages: [{ role: 'user', content: 'Analyze this' }]
        };
        
        const transformed = handler.transformRequest(body, 'deepseek-chat-reasoning-medium');
        
        expect(transformed.model).toBe('deepseek-chat');
        expect(transformed.reasoning_effort).toBe('medium');
    });

    test('should parse response with reasoning content', async () => {
        const response = {
            id: 'test-id',
            choices: [{
                message: {
                    role: 'assistant',
                    content: 'Final answer',
                    reasoning_content: 'Let me think about this...'
                }
            }],
            usage: { prompt_tokens: 10, completion_tokens: 20 }
        };
        
        const parsed = await handler.transformResponse(response);
        
        expect(parsed.choices[0].message.reasoning_content).toContain('Let me think about this...');
        expect(parsed.choices[0].message.content).toContain('Final answer');
    });

    test('should parse normal response', async () => {
        const response = {
            id: 'test-id',
            choices: [{
                message: {
                    role: 'assistant',
                    content: 'Normal response'
                }
            }],
            usage: { prompt_tokens: 10, completion_tokens: 20 }
        };
        
        const parsed = await handler.transformResponse(response);
        
        expect(parsed.choices[0].message.content).toBe('Normal response');
    });

    test('should extract usage from response', () => {
        const response = {
            usage: {
                prompt_tokens: 100,
                completion_tokens: 200
            }
        };
        
        const usage = handler.extractUsage(response);
        
        expect(usage.promptTokens).toBe(100);
        expect(usage.completionTokens).toBe(200);
    });

    test('should handle missing usage', () => {
        const response = {};
        const usage = handler.extractUsage(response);
        
        expect(usage.promptTokens).toBe(0);
        expect(usage.completionTokens).toBe(0);
    });
});

describe('Suno Provider Tests', () => {
    const handler = SunoApiHandler;

    test('should build correct headers', () => {
        const headers = handler.buildHeaders('test-api-key');
        
        expect(headers.get('Authorization')).toBe('Bearer test-api-key');
        expect(headers.get('Content-Type')).toBe('application/json');
    });

    test('should transform request with prompt', () => {
        const body = {
            prompt: 'Create a happy song',
            make_instrumental: false,
            mv: 'chirp-v3-5'
        };
        
        const transformed = handler.transformRequest(body, 'suno-v3.5');
        
        expect(transformed.prompt).toBe('Create a happy song');
        expect(transformed.make_instrumental).toBe(false);
        expect(transformed.mv).toBe('chirp-v3-5');
    });

    test('should transform request from messages', () => {
        const body = {
            messages: [
                { role: 'user', content: 'Generate a rock song' }
            ]
        };
        
        const transformed = handler.transformRequest(body, 'suno-v3.0');
        
        expect(transformed.prompt).toBe('Generate a rock song');
        expect(transformed.mv).toBe('chirp-v3-0');
    });

    test('should use v3.5 for v3.5 model', () => {
        const body = {
            messages: [{ role: 'user', content: 'Test' }]
        };
        
        const transformed = handler.transformRequest(body, 'suno-v3.5');
        
        expect(transformed.mv).toBe('chirp-v3-5');
    });

    test('should parse array response', async () => {
        const response = [
            {
                id: 'song-1',
                title: 'Test Song',
                image_url: 'https://example.com/image.jpg',
                audio_url: 'https://example.com/audio.mp3',
                video_url: 'https://example.com/video.mp4',
                created_at: '2024-01-01',
                status: 'completed',
                model_name: 'chirp-v3-0'
            }
        ];
        
        const parsed = await handler.transformResponse(response);
        
        expect(parsed.id).toContain('suno-');
        expect(parsed.model).toBe('suno');
        expect(parsed.choices[0].message.role).toBe('assistant');
        
        const content = JSON.parse(parsed.choices[0].message.content);
        expect(content[0].title).toBe('Test Song');
        expect(content[0].audio_url).toBe('https://example.com/audio.mp3');
    });

    test('should parse object response', async () => {
        const response = {
            id: 'song-2',
            title: 'Another Song',
            status: 'processing'
        };
        
        const parsed = await handler.transformResponse(response);
        
        expect(parsed.id).toContain('suno-');
        expect(parsed.choices[0].finish_reason).toBe('stop');
        
        const content = JSON.parse(parsed.choices[0].message.content);
        expect(content.id).toBe('song-2');
        expect(content.title).toBe('Another Song');
    });

    test('should extract usage from response', () => {
        const response = {
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0
            }
        };
        
        const usage = handler.extractUsage(response);
        
        expect(usage.promptTokens).toBe(0);
        expect(usage.completionTokens).toBe(0);
    });

    test('should handle missing usage', () => {
        const response = {};
        const usage = handler.extractUsage(response);
        
        expect(usage.promptTokens).toBe(0);
        expect(usage.completionTokens).toBe(0);
    });
});
