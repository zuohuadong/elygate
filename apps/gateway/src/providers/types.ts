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

// Channel Type Constants (Compatible with New-API/One-API Definitions)
export const ChannelType = {
    OPENAI: 1,
    AZURE: 8,
    ANTHROPIC: 14,
    BAIDU: 15,
    ZEN: 16,
    ALI: 17,
    XUNFEI: 18,
    GEMINI: 23,
    MIDJOURNEY: 24,
    JINA: 25,
    SUNO: 26,
    DEEPSEEK: 31,
    CF_WORKER: 33,
    FLUX: 34,
    UDIO: 35,
    NVIDIA: 41,
    DAKKA: 42,
    COMFYUI: 100,
} as const;
