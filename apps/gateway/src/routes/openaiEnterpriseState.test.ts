import { describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {},
    sql: {},
}));

const {
    serializeAssistant,
    serializeFineTuningJob,
    serializeMessage,
    serializeRun,
    serializeThread,
    serializeVectorStore,
    serializeVectorStoreFile,
} = await import('./openai-enterprise');

const createdAt = new Date('2026-06-27T00:00:00.000Z');

describe('OpenAI enterprise state-machine serializers', () => {
    test('serializes assistants, threads, and messages with OpenAI-compatible object shapes', () => {
        expect(serializeAssistant({
            id: 'asst_1',
            createdAt,
            name: 'helper',
            model: 'gpt-4o',
            fileIds: ['file_1'],
            metadata: { tenant: 'default' },
        })).toMatchObject({
            id: 'asst_1',
            object: 'assistant',
            created_at: 1782518400,
            name: 'helper',
            model: 'gpt-4o',
            file_ids: ['file_1'],
            metadata: { tenant: 'default' },
            temperature: 1,
            top_p: 1,
        });

        expect(serializeThread({ id: 'thread_1', createdAt, toolResources: { code_interpreter: {} } })).toMatchObject({
            id: 'thread_1',
            object: 'thread',
            tool_resources: { code_interpreter: {} },
        });

        expect(serializeMessage({
            id: 'msg_1',
            threadId: 'thread_1',
            createdAt,
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
        })).toMatchObject({
            id: 'msg_1',
            object: 'thread.message',
            thread_id: 'thread_1',
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
        });
    });

    test('keeps run queue, progress, and cancellation states explicit', () => {
        const queued = serializeRun({
            id: 'run_1',
            threadId: 'thread_1',
            createdAt,
            expiresAt: new Date('2026-06-27T00:10:00.000Z'),
            status: 'queued',
            model: 'gpt-4o',
        });

        expect(queued).toMatchObject({
            id: 'run_1',
            object: 'thread.run',
            thread_id: 'thread_1',
            status: 'queued',
            expires_at: 1782519000,
            started_at: null,
            tool_choice: 'auto',
            response_format: 'auto',
        });

        expect(serializeRun({
            id: 'run_1',
            threadId: 'thread_1',
            createdAt,
            startedAt: new Date('2026-06-27T00:00:05.000Z'),
            cancelledAt: new Date('2026-06-27T00:00:10.000Z'),
            status: 'cancelling',
            model: 'gpt-4o',
        })).toMatchObject({
            status: 'cancelling',
            started_at: 1782518405,
            cancelled_at: 1782518410,
        });
    });

    test('serializes vector store files and fine-tuning transitions without Redis state', () => {
        expect(serializeVectorStore({
            id: 'vs_1',
            createdAt,
            name: 'docs',
        })).toMatchObject({
            id: 'vs_1',
            object: 'vector_store',
            usage_bytes: 0,
            status: 'completed',
            file_counts: { in_progress: 0, completed: 0, failed: 0, cancelled: 0, total: 0 },
        });

        expect(serializeVectorStoreFile({
            id: 'file_1',
            vectorStoreId: 'vs_1',
            createdAt,
            status: 'completed',
        })).toMatchObject({
            id: 'file_1',
            object: 'vector_store.file',
            vector_store_id: 'vs_1',
            status: 'completed',
        });

        expect(serializeFineTuningJob({
            id: 'ftjob_1',
            createdAt,
            updatedAt: createdAt,
            model: 'gpt-4o-mini',
            trainingFileId: 'file_train',
            status: 'validating_files',
        })).toMatchObject({
            id: 'ftjob_1',
            object: 'fine_tuning.job',
            status: 'validating_files',
            training_file: 'file_train',
            result_files: [],
            error: null,
        });

        expect(serializeFineTuningJob({
            id: 'ftjob_1',
            createdAt,
            updatedAt: createdAt,
            finishedAt: new Date('2026-06-27T00:05:00.000Z'),
            model: 'gpt-4o-mini',
            trainingFileId: 'file_train',
            status: 'cancelled',
        })).toMatchObject({
            status: 'cancelled',
            finished_at: 1782518700,
        });
    });
});
