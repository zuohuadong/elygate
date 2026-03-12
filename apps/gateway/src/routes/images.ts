import { createProxyRoute } from './proxy';

export const imagesRouter = createProxyRoute({
    path: '/images/generations',
    endpointType: 'images',
    requiredFields: ['prompt'],
    defaultModel: 'dall-e-3'
});
