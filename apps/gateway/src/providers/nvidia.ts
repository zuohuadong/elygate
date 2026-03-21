import { ProviderHandler } from './types';

/**
 * NVIDIA NIM API Provider Handler
 * 
 * NVIDIA NIM supports OpenAI-compatible endpoints for chat and embeddings.
 * 
 * Supported endpoints:
 * - Chat: /v1/chat/completions (OpenAI compatible)
 * - Embeddings: /v1/embeddings (OpenAI compatible)
 * 
 * Note: Image/Audio/Video models on NVIDIA NIM cloud are not available
 * through standard endpoints. They are hosted on partner platforms like
 * SiliconFlow (硅基流动).
 * 
 * Reference: https://build.nvidia.com/explore/discover/models
 */
export class NvidiaApiHandler implements ProviderHandler {

    transformRequest(body: Record<string, any>, model: string) {
        const transformed: Record<string, any> = {
            ...body,
            model
        };

        // Disable thinking mode for -F suffix models (Qwen3.5 style)
        if (model.endsWith('-F')) {
            transformed.chat_template_kwargs = {
                ...(body.chat_template_kwargs || {}),
                enable_thinking: false
            };
        }

        return transformed;
    }

    transformResponse(data: Record<string, any>) {
        return data;
    }

    extractUsage(data: Record<string, any>) {
        return {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
        };
    }

    buildHeaders(apiKey: string) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${apiKey}`);
        return headers;
    }
}

/**
 * NVIDIA NIM Model Categories:
 * 
 * Chat Models (via /v1/chat/completions):
 * - meta/llama-3.1-8b-instruct
 * - meta/llama-3.1-70b-instruct
 * - meta/llama-3.3-70b-instruct
 * - google/gemma-2-9b-it
 * - google/gemma-3-*
 * - mistralai/mistral-7b-instruct-v0.3
 * - deepseek-ai/deepseek-v3.1
 * - microsoft/phi-3-*
 * - qwen/qwen2.5-*
 * - And 150+ more models
 * 
 * Embedding Models (via /v1/embeddings):
 * - baai/bge-m3
 * - nvidia/nv-embedqa-e5-v5
 * - And more
 * 
 * NOT Available on NVIDIA NIM Cloud:
 * - Image generation (FLUX, etc.) → Use SiliconFlow channel
 * - Audio TTS/ASR → Use SiliconFlow or OpenAI channel
 * - Video generation → Use dedicated channels
 */
