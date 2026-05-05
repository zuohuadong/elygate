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
    UNKNOWN: 0,
    OPENAI: 1,
    MIDJOURNEY: 2,
    AZURE: 3,
    OLLAMA: 4,
    MIDJOURNEY_PLUS: 5,
    OPENAI_MAX: 6,
    OH_MY_GPT: 7,
    CUSTOM: 8,
    AILS: 9,
    AI_PROXY: 10,
    PALM: 11,
    API2GPT: 12,
    AIGC2D: 13,
    ANTHROPIC: 14,
    BAIDU: 15,
    ZHIPU: 16,
    ALI: 17,
    XUNFEI: 18,
    QIHOO_360: 19,
    OPENROUTER: 20,
    AI_PROXY_LIBRARY: 21,
    FASTGPT: 22,
    TENCENT: 23,
    GEMINI: 24,
    MOONSHOT: 25,
    ZHIPU_V4: 26,
    PERPLEXITY: 27,
    LINGYI_WANWU: 31,
    AWS: 33,
    COHERE: 34,
    MINIMAX: 35,
    SUNO: 36,
    DIFY: 37,
    JINA: 38,
    CLOUDFLARE: 39,
    SILICONFLOW: 40,
    VERTEX_AI: 41,
    MISTRAL: 42,
    DEEPSEEK: 43,
    MOKA_AI: 44,
    VOLCENGINE: 45,
    BAIDU_V2: 46,
    XINFERENCE: 47,
    XAI: 48,
    COZE: 49,
    KLING: 50,
    JIMENG: 51,
    VIDU: 52,
    SUBMODEL: 53,
    DOUBAO_VIDEO: 54,
    SORA: 55,
    REPLICATE: 56,
    CODEX: 57,
    // Legacy Elygate-specific types (kept for backward compat with existing DB data)
    NVIDIA: 1001,
    FLUX: 1002,
    UDIO: 1003,
    DAKKA: 1004,
    COMFYUI: 100,
} as const;
