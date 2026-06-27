import { beforeEach, describe, expect, mock, test } from 'bun:test';

type BatchRow = { id: string };

const state: {
    pending: BatchRow[];
    claimed: BatchRow[];
    enqueued: string[];
    updateSets: Array<Record<string, unknown>>;
} = {
    pending: [],
    claimed: [],
    enqueued: [],
    updateSets: [],
};

const db = {
    select: mock(() => ({
        from: () => ({
            where: () => ({
                limit: async () => state.pending,
            }),
        }),
    })),
    update: mock(() => ({
        set: (values: Record<string, unknown>) => {
            state.updateSets.push(values);
            return {
                where: () => ({
                    returning: async () => state.claimed,
                }),
            };
        },
    })),
};

mock.module('@elygate/db', () => ({ db }));

mock.module('./jobQueue', () => ({
    enqueueBatchProcess: async (batchId: string) => {
        state.enqueued.push(batchId);
        return `job_${batchId}`;
    },
}));

mock.module('./logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const { scanPendingBatches } = await import('./batchExecutor');

describe('batch executor pg-boss dispatch', () => {
    beforeEach(() => {
        state.pending = [];
        state.claimed = [];
        state.enqueued = [];
        state.updateSets = [];
    });

    test('claims validating batches and enqueues pg-boss processing jobs', async () => {
        state.pending = [{ id: 'batch_1' }];
        state.claimed = [{ id: 'batch_1' }];

        await scanPendingBatches();

        expect(state.updateSets[0]).toEqual({ status: 'in_progress' });
        expect(state.enqueued).toEqual(['batch_1']);
    });

    test('skips enqueue when another scanner already claimed the batch', async () => {
        state.pending = [{ id: 'batch_race' }];
        state.claimed = [];

        await scanPendingBatches();

        expect(state.enqueued).toEqual([]);
    });
});
