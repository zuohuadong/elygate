import { log } from '../services/logger';
import type { ProviderHandler } from './types';

export const ZhipuProvider: ProviderHandler = {
    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Authorization', `Bearer ${apiKey}`);
        headers.set('Content-Type', 'application/json');
        return headers;
    },

    transformRequest(body: Record<string, any>, model: string) {
        // Standard payload passes through. 
        // For cogvideo, if the body uses "image_url", it's kept as is since Zhipu natively accepts it.
        return {
            ...body,
            model,
        };
    },

    transformResponse(data: Record<string, any>) {
        return data; // Usually compatible with OpenAI, or returns { id: "taskId" } for async video
    },

    extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
        };
    },

    overrideRequestUrl(baseUrl: string, model: string, endpointType: string) {
        let base = baseUrl.replace(/\/+$/, '');
        // Zhipu uses specific /api/paas/v4 structure for Videos
        if (model.toLowerCase().includes('cogvideox') || endpointType === 'video') {
            if (base.endsWith('/v4')) {
                return `${base}/videos/generations`;
            }
            if (base.endsWith('/v1')) {
                base = base.slice(0, -3); // remove /v1 fallback
                return `${base}/api/paas/v4/videos/generations`;
            }
            return `${base}/api/paas/v4/videos/generations`;
        }
        return undefined; // Let default builder handle it
    },

    async pollAsyncResult(taskId: string, baseUrl: string, apiKey: string) {
        let base = baseUrl.replace(/\/+$/, '');
        if (base.endsWith('/v1')) base = base.slice(0, -3);
        
        // Zhipu's new V4 async result fetching standard
        // (Often POST /video/submit => GET /api/paas/v4/async-result/{id})
        const statusUrl = `${base.endsWith('/v4') ? base : base + '/api/paas/v4'}/async-result/${taskId}`;

        log.info(`[Zhipu Video] Async task ${taskId} submitted. Polling ${statusUrl}...`);

        for (let attempt = 1; attempt <= 120; attempt++) {
            await new Promise(r => setTimeout(r, 5000)); // Poll every 5s

            try {
                const res = await fetch(statusUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });

                if (!res.ok) {
                    log.warn(`[Zhipu Video] Poll attempt ${attempt} failed with status ${res.status}`);
                    continue;
                }

                const data = await res.json();
                
                // Zhipu async format usually puts status in task_status and results in video_result
                if (data.task_status === 'SUCCESS' || data.task_status === 'COMPLETED') {
                    const videoResult = data.video_result || [];
                    const url = videoResult[0]?.url || data.url || '';
                    return {
                        id: taskId,
                        model: data.model || 'cogvideox-3',
                        videos: [{ 
                            url, 
                            cover_url: videoResult[0]?.cover_image_url || '' 
                        }]
                    };
                }

                if (data.task_status === 'FAIL' || data.task_status === 'FAILED') {
                    throw new Error(`Task failed: ${JSON.stringify(data)}`);
                }
                
                // Keep polling if status is PROCESSING
            } catch (err: any) {
                log.error(`[Zhipu Video] Polling Error: ${err.message}`);
            }
        }
        throw new Error(`Video polling timed out after 120 attempts`);
    }
};
