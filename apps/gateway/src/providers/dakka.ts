import type { ProviderHandler } from './types';
import { log } from '../services/logger';

export const DakkaApiHandler: ProviderHandler = {
    transformRequest,
    transformResponse,
    extractUsage,
    buildHeaders
};

function transformRequest(body: Record<string, any>, model: string): Record<string, any> {
    // Extract prompt from OpenAI request format
    let prompt = '';
    if (body.prompt) {
        prompt = body.prompt;
    } else if (body.messages && body.messages.length > 0) {
        const lastMsg = body.messages[body.messages.length - 1];
        prompt = typeof lastMsg.content === 'string' ? lastMsg.content : lastMsg.content?.[0]?.text || '';
    }

    // Extract image URLs from messages (for img2img / multi-image fusion)
    const urls: string[] = [];
    if (body.messages) {
        for (const msg of body.messages) {
            if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'image_url' && part.image_url?.url) {
                        urls.push(part.image_url.url);
                    }
                }
            }
        }
    }

    // nano-banana models use different request format
    if (model.startsWith('nano-banana')) {
        const req: Record<string, any> = {
            model,
            prompt,
        };

        // nano-banana uses aspectRatio instead of size
        if (body.aspectRatio) {
            req.aspectRatio = body.aspectRatio;
        } else if (body.size) {
            if (body.size === '1024x1024' || body.size === '1:1') req.aspectRatio = '1:1';
            else if (body.size === '1024x1792' || body.size === '9:16') req.aspectRatio = '9:16';
            else if (body.size === '1792x1024' || body.size === '16:9') req.aspectRatio = '16:9';
            else req.aspectRatio = body.size;
        }

        if (body.imageSize && (model === 'nano-banana-pro' || model === 'nano-banana-pro-vt')) {
            req.imageSize = body.imageSize;
        }

        if (urls.length > 0) {
            req.urls = urls.slice(0, 6);
        }

        return req;
    }

    // Standard sora-image / gpt-image-1.5 / veo format
    let size = '1:1';
    if (body.size) {
        if (body.size === '1024x1024') size = '1:1';
        else if (body.size === '1024x1792') size = '2:3';
        else if (body.size === '1792x1024') size = '3:2';
        else size = body.size;
    }

    const req: Record<string, any> = {
        model,
        prompt,
        size,
        variants: body.n || 1,
        shutProgress: true
    };

    if (urls.length > 0) {
        req.urls = urls;
    }

    return req;
}

async function transformResponse(
    data: Record<string, any>,
    context?: { baseUrl?: string; apiKey?: string; model?: string }
): Promise<Record<string, any>> {
    // 1. Detect upstream error responses (grsai returns errors with HTTP 200)
    //    e.g. {"code":-1,"data":null,"msg":"不存在该模型: veo3.1-fast"}
    if (data.code !== undefined && data.code !== 0) {
        throw new Error(`Upstream error: ${data.msg || data.message || JSON.stringify(data)}`);
    }
    if (data.status === 'failed' || data.status === 'error') {
        throw new Error(`Task failed: ${data.error || data.msg || data.message || 'Unknown error'}`);
    }

    // 2. Async task polling (veo video generation)
    //    Submit returns: {"code":0,"data":{"taskId":"xxx"},"msg":"ok"}
    //    Need to poll /v1/draw/result?taskId=xxx until completion
    if (data.data?.taskId && context?.baseUrl && context?.apiKey) {
        log.info(`[Dakka/Veo] Task submitted: ${data.data.taskId}. Starting result polling...`);
        const result = await pollForResult(data.data.taskId, context.baseUrl, context.apiKey);
        return result;
    }

    // 3. Extract URL from various response formats
    //    Dakka: { "results": [{"url":"..."}], "url": "..." }
    //    Veo:   { "video_url": "..." }
    let resultUrl = '';
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        resultUrl = data.results[0].url || data.results[0].video_url || '';
    }
    if (!resultUrl && data.url) {
        resultUrl = data.url;
    }
    if (!resultUrl && data.video_url) {
        resultUrl = data.video_url;
    }
    // Also check nested data.data[].url (some providers nest it)
    if (!resultUrl && data.data && Array.isArray(data.data) && data.data.length > 0) {
        resultUrl = data.data[0].url || data.data[0].video_url || '';
    }
    // Check data.data.url (single object)
    if (!resultUrl && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        resultUrl = data.data.url || data.data.video_url || '';
    }

    // 4. Reject empty URL results — they're useless and should not be cached
    if (!resultUrl) {
        throw new Error(`Upstream returned no result URL. Raw: ${JSON.stringify(data).substring(0, 200)}`);
    }

    return {
        created: Math.floor(Date.now() / 1000),
        data: [
            {
                url: resultUrl
            }
        ]
    };
}

/**
 * Poll grsai /v1/draw/result for async task completion.
 * Veo video generation is async: submit returns taskId, poll until video URL is ready.
 */
async function pollForResult(
    taskId: string,
    baseUrl: string,
    apiKey: string,
    maxAttempts = 60,    // Max 60 polls
    intervalMs = 5000    // 5 seconds between polls (total max ~5 minutes)
): Promise<Record<string, any>> {
    const base = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const resultUrl = `${base}/v1/draw/result?taskId=${taskId}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, intervalMs));

        try {
            const res = await fetch(resultUrl, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = await res.json() as Record<string, any>;

            // Error response
            if (result.code !== undefined && result.code !== 0) {
                throw new Error(`Poll error: ${result.msg || JSON.stringify(result)}`);
            }

            // Check if task is still processing
            const status = result.data?.status || result.status;
            if (status === 'pending' || status === 'processing' || status === 'running') {
                log.info(`[Dakka/Veo] Task ${taskId} still ${status} (attempt ${attempt}/${maxAttempts})`);
                continue;
            }

            if (status === 'failed' || status === 'error') {
                throw new Error(`Task ${taskId} failed: ${result.data?.error || result.msg || 'Unknown error'}`);
            }

            // Task completed — extract the video/image URL
            let url = '';
            const taskData = result.data || result;

            if (taskData.results && Array.isArray(taskData.results) && taskData.results.length > 0) {
                url = taskData.results[0].url || taskData.results[0].video_url || '';
            }
            if (!url && taskData.url) url = taskData.url;
            if (!url && taskData.video_url) url = taskData.video_url;
            if (!url && taskData.output?.url) url = taskData.output.url;
            if (!url && taskData.output?.video_url) url = taskData.output.video_url;

            if (url) {
                log.info(`[Dakka/Veo] Task ${taskId} completed. URL obtained.`);
                return {
                    created: Math.floor(Date.now() / 1000),
                    data: [{ url }]
                };
            }

            // If status is "succeeded" but no URL found, still succeed — maybe URL is at top level
            if (status === 'succeeded' || status === 'completed') {
                throw new Error(`Task ${taskId} completed but no URL found. Raw: ${JSON.stringify(result).substring(0, 300)}`);
            }

            log.info(`[Dakka/Veo] Task ${taskId} unknown status: ${status} (attempt ${attempt}/${maxAttempts})`);
        } catch (e: any) {
            if (e.message.includes('Poll error') || e.message.includes('failed') || e.message.includes('completed but no URL')) {
                throw e;
            }
            log.warn(`[Dakka/Veo] Poll attempt ${attempt} failed: ${e.message}`);
        }
    }

    throw new Error(`Task ${taskId} timed out after ${maxAttempts} polls (${(maxAttempts * intervalMs / 1000)}s)`);
}

function extractUsage(data: Record<string, any>): { promptTokens: number; completionTokens: number } {
    return { promptTokens: 1000, completionTokens: 0 };
}

function buildHeaders(apiKey: string): Headers {
    return new Headers({
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    });
}
