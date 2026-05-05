export interface ProviderHandler {
    /**
     * Transforms standard OpenAI request body to the format required by this provider.
     */
    transformRequest(body: Record<string, any>, model: string): Record<string, any>;

    /**
     * Transforms non-streaming response from upstream to standard OpenAI response format.
     */
    transformResponse(data: Record<string, any>, context?: { baseUrl?: string; apiKey?: string; model?: string }): Record<string, any> | Promise<Record<string, any>>;

    /**
     * Extracts and calculates token usage from non-streaming response.
     */
    extractUsage(data: Record<string, any>): { promptTokens: number; completionTokens: number; cachedTokens?: number };

    /**
     * (Optional) Different providers may have specific Headers requirements.
     */
    buildHeaders(apiKey: string): Headers;

    /**
     * (Optional) Dynamically overrides the generated upstream URL if the endpoint requires specific paths.
     */
    overrideRequestUrl?(baseUrl: string, model: string, endpointType: string): string | undefined;

    /**
     * (Optional) Custom async polling logic for providers that don't follow the default SiliconFlow video/status protocol.
     */
    pollAsyncResult?(taskId: string, baseUrl: string, apiKey: string): Promise<Record<string, any>>;
}

// Channel Type Constants (Aligned with New API definitions up to type 57)
export const ChannelType = {
    OPENAI: 1,
    MIDJOURNEY: 2,
    AZURE: 3,
    OLLAMA: 4,
    MIDJOURNEY_PLUS: 5,
    CUSTOM: 8,
    ANTHROPIC: 14,
    BAIDU: 15,
    ZHIPU: 16,
    ALI: 17,
    XUNFEI: 18,
    OPENROUTER: 20,
    TENCENT: 23,
    GEMINI: 24,
    MOONSHOT: 25,
    PERPLEXITY: 27,
    DEEPSEEK: 31,
    COHERE: 34,
    MINIMAX: 35,
    SUNO: 36,
    DIFY: 37,
    JINA: 38,
    CLOUDFLARE: 39,
    SILICONFLOW: 40,
    VERTEX_AI: 41,
    MISTRAL: 42,
    NVIDIA: 43,
    VOLCENGINE: 45,
    BAIDU_V2: 46,
    XAI: 48,
    COZE: 49,
    KLING: 50,
    JIMENG: 51,
    VIDU: 52,
    SORA: 55,
    REPLICATE: 56,
    // Legacy Elygate-specific types (kept for backward compat with existing DB data)
    FLUX: 34,
    UDIO: 35,
    DAKKA: 42,
    CODEX: 57,
    COMFYUI: 100,
} as const;
