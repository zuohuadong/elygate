import { Elysia } from 'elysia';
import type { ElysiaCtx } from '../types';

const NOT_IMPLEMENTED = { error: { message: 'Fine-tuning is not implemented. This endpoint exists for OpenAI client compatibility.', type: 'not_implemented', code: 'NOT_IMPLEMENTED' } };

function relayNotImplemented({ set }: ElysiaCtx) {
    set.status = 501;
    return NOT_IMPLEMENTED;
}

/**
 * Fine-tune compatibility routes.
 * New API and OpenAI clients may call these; we respond with standard not-implemented errors
 * rather than 404, so clients can handle gracefully.
 */
export const fineTuneRouter = new Elysia()
    .post('/fine-tunes', relayNotImplemented)
    .get('/fine-tunes', relayNotImplemented)
    .get('/fine-tunes/:id', relayNotImplemented)
    .post('/fine-tunes/:id/cancel', relayNotImplemented)
    .get('/fine-tunes/:id/events', relayNotImplemented);
