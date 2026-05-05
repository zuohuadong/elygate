import { Elysia } from 'elysia';

const NOT_IMPLEMENTED = { error: { message: 'Fine-tuning is not implemented. This endpoint exists for OpenAI client compatibility.', type: 'not_implemented', code: 'NOT_IMPLEMENTED' } };

/**
 * Fine-tune compatibility routes.
 * New API and OpenAI clients may call these; we respond with standard not-implemented errors
 * rather than 404, so clients can handle gracefully.
 */
export const fineTuneRouter = new Elysia()
    .post('/fine-tunes', () => NOT_IMPLEMENTED)
    .get('/fine-tunes', () => NOT_IMPLEMENTED)
    .get('/fine-tunes/:id', () => NOT_IMPLEMENTED)
    .post('/fine-tunes/:id/cancel', () => NOT_IMPLEMENTED)
    .get('/fine-tunes/:id/events', () => NOT_IMPLEMENTED);
