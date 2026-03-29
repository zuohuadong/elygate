import type { ElysiaCtx } from '../types';
import { Elysia, t } from 'elysia';
import { memoryCache } from '../services/cache';
import { authPlugin } from '../middleware/auth';
import { ChannelType  } from '../providers/types';
import { buildUpstreamUrl } from '../utils/url';

export const capabilitiesRouter = new Elysia({ prefix: '/v1' })
    .use(authPlugin)
    .get('/capabilities', async () => {
        // Collect all available models and their capabilities
        const channels = Array.from(memoryCache.channels.values());
        const activeChannels = channels.filter(c => c.status === 1);
        
        const modelsMap = new Map<string, Set<string>>();
        
        for (const channel of activeChannels) {
            const models = typeof channel.models === 'string' ? JSON.parse(channel.models) : channel.models;
            for (const model of models) {
                if (!modelsMap.has(model)) {
                    modelsMap.set(model, new Set());
                }
                const caps = modelsMap.get(model)!;
                
                // Infer capabilities based on model name patterns or channel type
                if (model.includes('gpt') || model.includes('claude') || model.includes('gemini') || model.includes('qwen')) {
                    caps.add('chat');
                    caps.add('stream');
                }
                if (model.includes('dall-e') || model.includes('midjourney') || model.includes('flux')) {
                    caps.add('images');
                }
                if (model.includes('whisper') || model.includes('tts')) {
                    caps.add('audio');
                }
                if (model.includes('rerank')) {
                    caps.add('rerank');
                }
                if (model.includes('embedding')) {
                    caps.add('embeddings');
                }
                if (model.includes('sora') || model.includes('luma') || model.includes('runway') || model.includes('video')) {
                    caps.add('video');
                }
            }
        }

        const models = Array.from(modelsMap.entries()).map(([name, caps]) => ({
            name,
            capabilities: Array.from(caps)
        }));

        return {
            success: true,
            data: {
                version: "1.0.0",
                capabilities: {
                    chat: models.some(m => m.capabilities.includes('chat')),
                    images: models.some(m => m.capabilities.includes('images')),
                    video: models.some(m => m.capabilities.includes('video')),
                    audio: models.some(m => m.capabilities.includes('audio')),
                    embeddings: models.some(m => m.capabilities.includes('embeddings')),
                    moderations: true,
                    rerank: models.some(m => m.capabilities.includes('rerank')),
                    idempotency: true
                },
                models,
                default_model: "gpt-4o-mini"
            }
        };
    })
    .post('/self-test', async ({ body, user, set }: ElysiaCtx) => {
        const { model } = body;
        if (!model) {
            set.status = 400;
            return { success: false, error: "Model is required for self-test" };
        }

        const channels = memoryCache.selectChannels(model, user.group);
        if (!channels || channels.length === 0) {
            return {
                success: false,
                connected: false,
                error: `No channels configured for model ${model} in group ${user.group}`
            };
        }

        // Test the first channel in the list
        const channel = channels[0];
        return {
            success: true,
            connected: true,
            channel: channel.name,
            type: channel.type,
            status: channel.status === 1 ? 'active' : 'inactive'
        };
    }, {
        body: t.Object({
            model: t.String()
        })
    });
