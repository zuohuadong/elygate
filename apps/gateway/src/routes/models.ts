import { Elysia } from 'elysia';
import { memoryCache } from '../services/cache';

/**
 * Models Router
 * Exposes /v1/models endpoint compatible with OpenAI schema.
 * Dynamically aggregates supported models from all active channels in memory.
 */
export const modelsRouter = new Elysia()
    .get('/v1/models', () => {
        // Collect unique models from cache
        const uniqueModels = Array.from(memoryCache.channelRoutes.keys());

        const modelsData = uniqueModels.map(model => ({
            id: model,
            object: 'model',
            created: Math.floor(Date.now() / 1000), // Mock timestamp
            owned_by: 'elygate',
            permission: [],
            root: model,
            parent: null,
        }));

        return {
            object: 'list',
            data: modelsData,
        };
    });
