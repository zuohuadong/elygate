import { Elysia } from 'elysia';
import { memoryCache } from '../services/cache';
import type { UserRecord, type TokenRecord , ElysiaCtx } from '../types';
import { matchPattern } from '../utils/pattern';

/**
 * /v1/models endpoint - lists available models filtered by user permissions
 */
export const modelsRouter = new Elysia()
    .get('/models', ({ user, token, set, query }: ElysiaCtx) => {
        if (!user || !token) {
            set.status = 401;
            return { success: false, message: "Unauthorized: Auth context missing" };
        }

        const u = user as UserRecord;
        const t = token as TokenRecord;
        const includeChannels = query?.include_channels === 'true' || query?.include_channels === true;

        let uniqueModels = Array.from(memoryCache.channelRoutes.keys());

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
                const modelData: Record<string, any> = {
                    id: model,
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'elygate',
                    permission: [],
                    root: model,
                    parent: null,
                };

                // Include channel information if requested (for admin)
                if (includeChannels) {
                    const channels = memoryCache.selectChannels(model, u.group);
                    modelData.channels = channels.map(ch => ({
                        id: ch.id,
                        name: ch.name,
                        type: ch.type,
                        status: ch.status,
                        priority: ch.priority,
                    }));
                }

                return modelData;
            })
        };
    })
    .get('/models/:model', ({ user, token, params, set }: ElysiaCtx) => {
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
