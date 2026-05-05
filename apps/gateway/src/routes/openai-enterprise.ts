import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';

function notImplemented(set: Record<string, any>, feature: string) {
    set.status = 501;
    return {
        error: {
            message: `${feature} route is present for OpenAI client compatibility, but the PostgreSQL-backed state machine is not implemented yet.`,
            type: 'not_implemented'
        }
    };
}

export const openaiEnterpriseRouter = new Elysia()
    .all('/assistants', ({ set }: ElysiaCtx) => notImplemented(set, 'Assistants API'))
    .all('/assistants/:assistant_id', ({ set }: ElysiaCtx) => notImplemented(set, 'Assistants API'))
    .all('/threads', ({ set }: ElysiaCtx) => notImplemented(set, 'Threads API'))
    .all('/threads/:thread_id', ({ set }: ElysiaCtx) => notImplemented(set, 'Threads API'))
    .all('/threads/:thread_id/messages', ({ set }: ElysiaCtx) => notImplemented(set, 'Thread Messages API'))
    .all('/threads/:thread_id/runs', ({ set }: ElysiaCtx) => notImplemented(set, 'Runs API'))
    .all('/threads/:thread_id/runs/:run_id', ({ set }: ElysiaCtx) => notImplemented(set, 'Runs API'))
    .all('/vector_stores', ({ set }: ElysiaCtx) => notImplemented(set, 'Vector Stores API'))
    .all('/vector_stores/:vector_store_id', ({ set }: ElysiaCtx) => notImplemented(set, 'Vector Stores API'))
    .all('/vector_stores/:vector_store_id/files', ({ set }: ElysiaCtx) => notImplemented(set, 'Vector Store Files API'))
    .all('/fine_tuning/jobs', ({ set }: ElysiaCtx) => notImplemented(set, 'Fine-tuning API'))
    .all('/fine_tuning/jobs/:fine_tuning_job_id', ({ set }: ElysiaCtx) => notImplemented(set, 'Fine-tuning API'));
