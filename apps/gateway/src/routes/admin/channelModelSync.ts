import { ChannelType } from '../../types';

function parseJsonObject(value: unknown): Record<string, string> {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {};
}

export function normalizeChannelModels(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
    } catch {
        return [];
    }
}

export function parseUpstreamModels(data: any, channelType: number): string[] {
    if (channelType === ChannelType.GEMINI) {
        return data?.models?.map((m: Record<string, any>) => m.name?.replace('models/', '') || m.displayName).filter(Boolean) || [];
    }
    if (Array.isArray(data?.data)) return data.data.map((m: Record<string, any>) => m.id).filter(Boolean);
    if (Array.isArray(data)) return data.map((m: Record<string, any>) => m.id || m.name).filter(Boolean);
    return [];
}

export function reconcileChannelModelSync(input: {
    currentModels: unknown;
    upstreamModels: readonly string[];
    modelMapping: unknown;
}) {
    const oldModels = normalizeChannelModels(input.currentModels);
    const upstreamModels = [...input.upstreamModels];
    const upstreamSet = new Set(upstreamModels);
    const removedModels = oldModels.filter((model) => !upstreamSet.has(model));
    const newModels = upstreamModels.filter((model) => !oldModels.includes(model));
    const modelMapping = parseJsonObject(input.modelMapping);
    const brokenAliases: string[] = [];

    for (const [alias, target] of Object.entries(modelMapping)) {
        if (!upstreamSet.has(target)) {
            brokenAliases.push(alias);
            delete modelMapping[alias];
        }
    }

    const skipPatterns = /flux|image|sd|stable|draw|kolors|tts|speech|sovits|bge|rerank|embed|whisper/i;
    const existingAliases = new Set(Object.keys(modelMapping));
    const existingTargets = new Set(Object.values(modelMapping));
    const generatedAliases: Record<string, string> = {};

    for (const model of newModels) {
        if (skipPatterns.test(model)) continue;
        if (!model.includes('/')) continue;

        let stripped = model;
        if (stripped.toLowerCase().startsWith('pro/')) stripped = stripped.substring(4);
        if (stripped.includes('/')) stripped = stripped.split('/').slice(1).join('/');

        if (stripped && stripped !== model
            && !existingAliases.has(stripped)
            && !existingTargets.has(model)
            && !upstreamSet.has(stripped)) {
            modelMapping[stripped] = model;
            generatedAliases[stripped] = model;
            existingAliases.add(stripped);
            existingTargets.add(model);
        }
    }

    return { oldModels, newModels, removedModels, modelMapping, brokenAliases, generatedAliases };
}
