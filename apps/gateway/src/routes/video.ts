import { createProxyRoute } from './proxy';

export const videoRouter = createProxyRoute({
    path: '/video/generations',
    endpointType: 'video',
    requiredFields: ['prompt']
});
