import { createProxyRoute } from './proxy';

export const rerankRouter = createProxyRoute({
    path: '/rerank',
    endpointType: 'rerank',
    requiredFields: ['query', 'documents']
});
