import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const createdTasks: Array<Record<string, any>> = [];

mock.module('../middleware/auth', () => ({
    authPlugin: new Elysia({ name: 'test-auth' }).derive(() => ({
        user: { id: 101, username: 'route-test', group: 'default', role: 1, quota: 1000, usedQuota: 0, status: 1 },
        token: { id: 202, userId: 101, name: 'route-test-token', key: 'sk-route-test', status: 1, remainQuota: 1000, usedQuota: 0, models: [], modelLimitsEnabled: false },
    })),
    assertModelAccess: () => undefined,
}));

mock.module('../services/task-service', () => ({
    createTask: async (opts: Record<string, any>) => {
        createdTasks.push(opts);
        return `task_test_${createdTasks.length}`;
    },
    getTask: async (taskId: string, userId?: number) => ({
        id: taskId,
        userId: userId ?? 101,
        tokenId: 202,
        model: 'kling-v1',
        type: 'video',
        status: 'completed',
        progress: 100,
        result: { url: 'https://media.example.test/video.mp4' },
        createdAt: new Date('2026-06-27T00:00:00.000Z'),
        updatedAt: new Date('2026-06-27T00:00:01.000Z'),
    }),
}));

const { createCompatTask, createMidjourneyCompatTask, newApiRelayCompatRouter } = await import('./newApiRelayCompat');

function app() {
    return new Elysia().use(newApiRelayCompatRouter);
}

async function json(response: Response) {
    return await response.json() as Record<string, any>;
}

describe('New API relay compatibility routes', () => {
    beforeEach(() => {
        createdTasks.length = 0;
    });

    test('creates PostgreSQL-backed task records for Kling text-to-video compatibility', async () => {
        const set: Record<string, any> = {};
        const response = await createCompatTask({
            body: { prompt: 'city skyline', model_name: 'kling-v2-master' },
            user: { id: 101, group: 'default' },
            token: { id: 202 },
            set,
        } as any, { type: 'video', defaultModel: 'kling-v1', action: 'kling_text2video' }) as Record<string, any>;

        expect(set.status).toBe(202);
        expect(response).toMatchObject({
            id: 'task_test_1',
            task_id: 'task_test_1',
            status: 'pending',
            action: 'kling_text2video',
            model: 'kling-v2-master',
        });
        expect(createdTasks[0]).toMatchObject({
            userId: 101,
            tokenId: 202,
            model: 'kling-v2-master',
            type: 'video',
            requestBody: { prompt: 'city skyline', action: 'kling_text2video', newApiCompat: true },
        });
    });

    test('maps Suno submit actions into audio task compatibility records', async () => {
        const set: Record<string, any> = {};
        const response = await createCompatTask({
            body: { prompt: 'lo-fi loop' },
            user: { id: 101, group: 'default' },
            token: { id: 202 },
            set,
        } as any, { type: 'audio', defaultModel: 'suno', action: 'suno_music', requirePrompt: false }) as Record<string, any>;

        expect(set.status).toBe(202);
        expect(response).toMatchObject({
            task_id: 'task_test_1',
            action: 'suno_music',
            model: 'suno',
        });
        expect(createdTasks[0]).toMatchObject({
            model: 'suno',
            type: 'audio',
            requestBody: { prompt: 'lo-fi loop', action: 'suno_music', newApiCompat: true },
        });
    });

    test('keeps New API Midjourney mode aliases routable without Redis', async () => {
        const set: Record<string, any> = {};
        const response = await createMidjourneyCompatTask({
            body: { base64: 'abc' },
            user: { id: 101, group: 'default' },
            token: { id: 202 },
            set,
        } as any, 'relax_describe') as Record<string, any>;

        expect(set.status).toBe(202);
        expect(response).toMatchObject({
            code: 1,
            description: 'success',
            result: 'task_test_1',
            properties: { action: 'relax_describe', status: 'pending' },
        });
        expect(createdTasks[0]).toMatchObject({
            model: 'mj-chat',
            type: 'image',
            requestBody: { action: 'mj_relax_describe', newApiCompat: true },
        });
    });

    test('serves New API Midjourney mode image alias', async () => {
        const response = await app().handle(new Request('http://localhost/relax/mj/image/img_123'));
        const body = await json(response);

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            code: 1,
            description: 'success',
            result: 'img_123',
            mode: 'relax',
        });
    });

    test('returns downloadable video content through New API content route', async () => {
        const response = await app().handle(new Request('http://localhost/v1/videos/task_123/content'));

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('https://media.example.test/video.mp4');
    });
});
