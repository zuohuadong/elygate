import { Elysia } from 'elysia';
import { createProxyRoute } from './proxy';

/**
 * Unified Audio Endpoints
 * Supports /v1/audio/speech, /v1/audio/transcriptions, /v1/audio/translations
 */
export const audioRouter = new Elysia()
    .use(createProxyRoute({ path: '/audio/speech', endpointType: 'audio/speech' }))
    .use(createProxyRoute({ path: '/audio/transcriptions', endpointType: 'audio/transcriptions' }))
    .use(createProxyRoute({ path: '/audio/translations', endpointType: 'audio/translations' }));
