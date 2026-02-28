/**
 * Multiplier/Ratio System Core (Inspired by New-API)
 * Formula: Cost = (PromptTokens + CompletionTokens * CompletionRatio) * ModelRatio * GroupRatio
 */

// 1. Base Model Ratios (Can be mapped to DB; currently in-memory for simplicity)
// Corresponds to the underlying cost per token (e.g., GPT-4 is 15x more expensive than 3.5)
export const ModelRatio: Record<string, number> = {
    'gpt-3.5-turbo': 1,
    'gpt-4': 15,
    'gpt-4o': 5,
    'claude-3-opus-20240229': 15,
    'claude-3-sonnet-20240229': 3,
    'gemini-1.5-pro-latest': 3,
    'gemini-1.5-flash-latest': 0.5,
    // Embeddings
    'text-embedding-3-small': 0.02,
    'text-embedding-3-large': 0.1,
    'text-embedding-ada-002': 0.05,
    // Images (Ratio becomes fixed cost per image since completionTokens = n)
    'dall-e-2': 20000,
    'dall-e-3': 40000,
};

// Completion Ratios for different models (Output price multiplier over input)
export const CompletionRatio: Record<string, number> = {
    'gpt-3.5-turbo': 1.33,
    'gpt-4': 2,
    'gpt-4o': 3,
    'claude-3-opus-20240229': 5,
    'claude-3-sonnet-20240229': 5,
    'gemini-1.5-pro-latest': 2,
    'gemini-1.5-flash-latest': 2,
};

// 2. Group-based Ratios (For VIP, SVIP, or Trial tiers)
export const GroupRatio: Record<string, number> = {
    'default': 1,
    'vip': 0.8,
    'svip': 0.6,
    'enterprise': 0.5 // Enterprise partnership price
};

/**
 * Calculates precise billing cost based on model and group factor.
 */
export function calculateCost(
    modelName: string,
    groupName: string,
    promptTokens: number,
    completionTokens: number
): number {
    const mRatio = ModelRatio[modelName] || 1; // Default to 1 if not found
    const cRatio = CompletionRatio[modelName] || 1; // Default to 1
    const gRatio = GroupRatio[groupName] || 1;

    // Detailed calculation: Base Cost = (Prompt * 1 + Completion * CompletionRatio) 
    const baseCost = promptTokens + (completionTokens * cRatio);

    // Final deduction = Math.ceil(baseCost * ModelRatio * GroupRatio)
    return Math.ceil(baseCost * mRatio * gRatio);
}
