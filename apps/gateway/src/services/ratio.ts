import { optionCache } from './optionCache';

/**
 * Multiplier/Ratio System Core (Inspired by New-API)
 * Formula: Cost = (PromptTokens + CompletionTokens * CompletionRatio) * ModelRatio * GroupRatio
 */

export function calculateCost(
    modelName: string,
    groupName: string,
    promptTokens: number,
    completionTokens: number
): number {
    const ModelRatio = optionCache.get('ModelRatio', { 'gpt-3.5-turbo': 1 });
    const CompletionRatio = optionCache.get('CompletionRatio', { 'gpt-3.5-turbo': 1.33 });
    const GroupRatio = optionCache.get('GroupRatio', { 'default': 1 });
    const GroupModelRatio = optionCache.get('GroupModelRatio', {}); // { "vip": { "gpt-4": 0.8 } }
    const FixedCostModels = optionCache.get('FixedCostModels', { 'flux': 50000, 'udio': 100000 }); // Cost per request

    // Check for fixed cost models first
    if (FixedCostModels[modelName] !== undefined) {
        const gRatio = GroupRatio[groupName] || 1;
        return Math.ceil(FixedCostModels[modelName] * gRatio);
    }

    const mRatio = ModelRatio[modelName] !== undefined ? ModelRatio[modelName] : 1;
    const cRatio = CompletionRatio[modelName] !== undefined ? CompletionRatio[modelName] : 1;
    const gRatio = GroupRatio[groupName] !== undefined ? GroupRatio[groupName] : 1;

    // Check for group-specific model ratio overrides
    let gmRatio = 1;
    if (GroupModelRatio[groupName] && GroupModelRatio[groupName][modelName]) {
        gmRatio = GroupModelRatio[groupName][modelName];
    }

    const baseCost = promptTokens + (completionTokens * cRatio);

    return Math.ceil(baseCost * mRatio * gRatio * gmRatio);
}
