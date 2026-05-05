import { optionCache } from './optionCache';

/**
 * Multiplier/Ratio System Core (Inspired by New-API)
 * Formula: Cost = (PromptTokens * CacheDiscount + CompletionTokens * CompletionRatio) * ModelRatio * GroupRatio
 *
 * CacheDiscount: When cachedTokens > 0, prompt tokens get a discount.
 *   Effective prompt cost = (promptTokens - cachedTokens) + cachedTokens * CacheRatio
 *   Default CacheRatio = 0.5 (50% discount on cached tokens)
 */

export function calculateCost(
    modelName: string,
    groupName: string,
    promptTokens: number,
    completionTokens: number,
    cachedTokens?: number,
): number {
    const ModelRatio = optionCache.get('ModelRatio', { 'gpt-3.5-turbo': 1 }) as Record<string, number>;
    const CompletionRatio = optionCache.get('CompletionRatio', { 'gpt-3.5-turbo': 1.33 }) as Record<string, number>;
    const GroupRatio = optionCache.get('GroupRatio', { 'default': 1 }) as Record<string, number>;
    const GroupModelRatio = optionCache.get('GroupModelRatio', {}) as Record<string, Record<string, number>>;
    const FixedCostModels = optionCache.get('FixedCostModels', { 'flux': 50000, 'udio': 100000 }) as Record<string, number>;
    const CacheRatio = optionCache.get('CacheRatio', 0.5) as number;

    // Check for fixed cost models first
    if (FixedCostModels[modelName] !== undefined) {
        const gRatio = GroupRatio[groupName] || 1;
        const count = Math.max(1, promptTokens + completionTokens);
        return Math.ceil(FixedCostModels[modelName] * count * gRatio);
    }

    const mRatio = ModelRatio[modelName] !== undefined ? ModelRatio[modelName] : 1;
    const cRatio = CompletionRatio[modelName] !== undefined ? CompletionRatio[modelName] : 1;
    const gRatio = GroupRatio[groupName] !== undefined ? GroupRatio[groupName] : 1;

    let gmRatio = 1;
    if (GroupModelRatio[groupName] && GroupModelRatio[groupName][modelName]) {
        gmRatio = GroupModelRatio[groupName][modelName];
    }

    // Apply cache discount: cached tokens cost CacheRatio instead of full price
    const effectiveCached = Math.min(cachedTokens || 0, promptTokens);
    const effectivePrompt = (promptTokens - effectiveCached) + (effectiveCached * CacheRatio);

    const baseCost = effectivePrompt + (completionTokens * cRatio);

    return Math.ceil(baseCost * mRatio * gRatio * gmRatio);
}

export function quotaToUSD(quota: number): number {
    return quota / 500000;
}

export function quotaToRMB(quota: number): number {
    const exchangeRate = Number(optionCache.get('ExchangeRate', 7.2));
    return (quota / 500000) * exchangeRate;
}

export function formatCurrency(value: number, symbol: string = '$'): string {
    return `${symbol}${value.toFixed(4)}`;
}
