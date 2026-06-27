export function buildCopiedChannelValues(source: Record<string, any>) {
    return {
        name: `[Copy] ${source.name}`,
        type: source.type,
        key: source.key,
        baseUrl: source.baseUrl,
        models: source.models,
        modelMapping: source.modelMapping,
        priority: source.priority,
        weight: source.weight,
        status: 3,
        keyStrategy: source.keyStrategy,
        keyStatus: source.keyStatus,
        priceRatio: source.priceRatio,
        keyConcurrencyLimit: source.keyConcurrencyLimit,
        endpointType: source.endpointType,
        groups: source.groups,
    };
}
