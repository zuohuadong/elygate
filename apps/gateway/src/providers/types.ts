export interface ProviderHandler {
    /**
     * Transforms standard OpenAI request body to the format required by this provider.
     */
    transformRequest(body: Record<string, any>, model: string): any;

    /**
     * Transforms non-streaming response from upstream to standard OpenAI response format.
     */
    transformResponse(data: any): any;

    /**
     * Extracts and calculates token usage from non-streaming response.
     */
    extractUsage(data: any): { promptTokens: number; completionTokens: number };

    /**
     * (Optional) Different providers may have specific Headers requirements.
     */
    buildHeaders(apiKey: string): Headers;
}

// Channel Type Constants (Compatible with New-API/One-API Definitions)
export const ChannelType = {
    OPENAI: 1,
    AZURE: 8,
    ANTHROPIC: 14,
    BAIDU: 15,
    ZEN: 16,
    ALI: 17,
    GEMINI: 23,
    DEEPSEEK: 31,
    CF_WORKER: 33,
} as const;
