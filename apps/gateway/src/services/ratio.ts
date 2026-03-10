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
    const ModelRatio = optionCache.get('ModelRatio', { 'gpt-3.5-turbo': 1 }) as Record<string, number>;
    const CompletionRatio = optionCache.get('CompletionRatio', { 'gpt-3.5-turbo': 1.33 }) as Record<string, number>;
    const GroupRatio = optionCache.get('GroupRatio', { 'default': 1 }) as Record<string, number>;
    const GroupModelRatio = optionCache.get('GroupModelRatio', {}) as Record<string, Record<string, number>>; // { "vip": { "gpt-4": 0.8 } }
    const FixedCostModels = optionCache.get('FixedCostModels', { 'flux': 50000, 'udio': 100000 }) as Record<string, number>; // Cost per request

    // Check for fixed cost models first
    if (FixedCostModels[modelName] !== undefined) {
        const gRatio = GroupRatio[groupName] || 1;
        // In endpoints like images, completionTokens carries the 'n' count
        const count = Math.max(1, promptTokens + completionTokens);
        return Math.ceil(FixedCostModels[modelName] * count * gRatio);
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

/**
 * Quota to Currency conversion
 * Default: 500,000 Quota = $1.00
 */
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
