import { Elysia } from 'elysia';
import { memoryCache } from '../services/cache';
import type { UserRecord,  TokenRecord  } from '../types';
import { matchPattern } from '../utils/pattern';

/**
 * /v1/models endpoint - lists available models filtered by user permissions
 */
export const modelsRouter = new Elysia()
    .get('/models', ({ user, token, set, query }: any) => {
        if (!user || !token) {
            set.status = 401;
            return { success: false, message: "Unauthorized: Auth context missing" };
        }

        const u = user as UserRecord;
        const t = token as TokenRecord;
        const includeChannels = query?.include_channels === 'true' || query?.include_channels === true;

        let allModels = Array.from(memoryCache.channelRoutes.keys())
            // Only show models that have at least one active channel (status=1 or 4)
            .filter(model => memoryCache.selectChannels(model, u.group).length > 0);

        // Deduplicate: remove vendor-prefixed names when short alias exists
        // e.g., if both "Qwen/Qwen3.5-397B-A17B" and "Qwen3.5-397B-A17B" exist, keep only the short one
        const modelSet = new Set(allModels);
        const deduped = allModels.filter(model => {
            if (model.includes('/')) {
                const shortName = model.split('/').slice(1).join('/');
                // If the short name (without prefix) also exists as a route, skip this prefixed version
                if (shortName && modelSet.has(shortName)) {
                    return false;
                }
            }
            return true;
        });

        // Case-insensitive dedup: if both "GLM-5" and "glm-5" exist, keep the first one
        const seenLower = new Map<string, string>(); // lowercase -> kept model name
        let uniqueModels = deduped.filter(model => {
            const lower = model.toLowerCase();
            if (seenLower.has(lower)) {
                return false;
            }
            seenLower.set(lower, model);
            return true;
        });

        // 1. Token Key Restrictions
        if (t.models && t.models.length > 0) {
            uniqueModels = uniqueModels.filter(m => t.models.includes(m));
        }

        // 2. Group Policy Enforcer (Dual-Dimensional)
        const groupPolicy = memoryCache.userGroups.get(u.group);
        if (groupPolicy) {
            uniqueModels = uniqueModels.filter(model => {
                // A. Active Package Exemption Bypass
                let isPackageFree = false;
                if (u.activePackages) {
                    for (const pkg of u.activePackages) {
                        if (pkg.models?.includes(model)) {
                            isPackageFree = true;
                            break;
                        }
                    }
                }
                if (isPackageFree) return true;

                // B. Allowed Models Filter (whitelist)
                if (groupPolicy.allowedModels && groupPolicy.allowedModels.length > 0) {
                    if (!matchPattern(model, groupPolicy.allowedModels)) {
                        return false;
                    }
                }

                // C. Denied Models Filter (blacklist)
                if (matchPattern(model, groupPolicy.deniedModels)) {
                    return false;
                }

                // D. Channel Type / Provider Filter
                let candidateChannels = memoryCache.selectChannels(model, u.group);
                if (groupPolicy.deniedChannelTypes && groupPolicy.deniedChannelTypes.length > 0) {
                    candidateChannels = candidateChannels.filter(ch => !groupPolicy.deniedChannelTypes.includes(ch.type));
                }
                if (groupPolicy.allowedChannelTypes && groupPolicy.allowedChannelTypes.length > 0) {
                    candidateChannels = candidateChannels.filter(ch => groupPolicy.allowedChannelTypes.includes(ch.type));
                }

                return candidateChannels.length > 0;
            });
        }

        return {
            object: 'list',
            data: uniqueModels.map(model => {
                // Determine model type from DB metadata only (no channel fallback)
                const meta = memoryCache.modelMetadata.get(model);
                const type = meta?.type || 'chat';
                const endpoint = meta?.endpoint || '/v1/chat/completions';

                const modelData: Record<string, any> = {
                    id: model,
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'elygate',
                    permission: [],
                    root: model,
                    parent: null,
                    type,
                    endpoint,
                };

                // Include channel information if requested (for admin)
                if (includeChannels) {
                    modelData.channels = memoryCache.selectChannels(model, u.group).map((ch: any) => ({
                        id: ch.id,
                        name: ch.name,
                        type: ch.type,
                        status: ch.status,
                        priority: ch.priority,
                        endpointType: ch.endpointType,
                    }));
                }

                return modelData;
            })
        };
    })
    .get('/models/:model', ({ user, token, params, set }: any) => {
        if (!user || !token) {
            set.status = 401;
            return { success: false, message: "Unauthorized" };
        }
        const model = params.model;
        return {
            id: model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'elygate',
            permission: [],
            root: model,
            parent: null,
        };
    });
