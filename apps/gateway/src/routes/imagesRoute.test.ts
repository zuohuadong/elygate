import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const dispatchCalls: Array<Record<string, unknown>> = [];

mock.module('../services/dispatcher', () => ({
    dispatch: async (options: Record<string, unknown>) => {
        dispatchCalls.push(options);
        return { id: 'img_passthrough', data: [] };
    },
}));

mock.module('../services/cache', () => ({
    memoryCache: {
        getTokenFromCache: async () => ({
            id: 2,
            userId: 1,
            name: 'image-token',
            key: 'sk-image',
            status: 1,
            remainQuota: 1000,
            usedQuota: 0,
            models: [],
        }),
        getUserFromDB: async () => ({
            id: 1,
            username: 'image-user',
            group: 'default',
            role: 1,
            quota: 1000,
            usedQuota: 0,
            status: 1,
        }),
    },
}));

mock.module('../services/task-service', () => ({
    createTask: async () => 'task_image',
}));

mock.module('../services/logger', () => ({
    log: {
        info: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const { imagesRouter } = await import('./images');

function app() {
    return new Elysia().use(imagesRouter);
}

describe('Images route passthrough compatibility', () => {
    beforeEach(() => {
        dispatchCalls.length = 0;
    });

    test('passes image edits through dispatcher without exact response cache conversion', async () => {
        const response = await app().handle(new Request('http://localhost/images/edits', {
            method: 'POST',
            headers: {
                authorization: 'Bearer sk-image',
                'content-type': 'application/json',
                'user-agent': 'test',
            },
            body: JSON.stringify({ model: 'dall-e-2', image: 'file_123', prompt: 'touch up' }),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ id: 'img_passthrough', data: [] });
        expect(dispatchCalls[0]).toMatchObject({
            model: 'dall-e-2',
            endpointType: 'images',
            stream: false,
        });
        expect(dispatchCalls[0].body).toEqual({ model: 'dall-e-2', image: 'file_123', prompt: 'touch up' });
    });
});
