import { createProxyRoute } from './proxy';

export const embeddingsRouter = createProxyRoute({
    path: '/embeddings',
    endpointType: 'embeddings',
    requiredFields: ['input']
});
