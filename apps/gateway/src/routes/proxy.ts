import type { ElysiaCtx } from '../types';
import { log } from '../services/logger';
import { Elysia } from 'elysia';
import { assertModelAccess } from '../middleware/auth';
import { UnifiedDispatcher, type DispatchOptions } from '../services/dispatcher';

interface ProxyRouteConfig {
    path: string;
    endpointType: DispatchOptions['endpointType'];
    requiredFields?: string[];
    defaultModel?: string;
    /** Extract model name from body (defaults to body.model) */
    getModel?: (body: Record<string, any>) => string | undefined;
}

/**
 * Generic proxy route factory.
 * Eliminates boilerplate for audio/video/images/embeddings/rerank endpoints
 * that all follow the same pattern: validate → access check → dispatch.
 */
export function createProxyRoute(config: ProxyRouteConfig): Elysia {
    const label = config.endpointType.replace('/', '_').toUpperCase();

    return new Elysia()
        .post(config.path, async ({ body, token, user, set }: ElysiaCtx) => {
            const model = (config.getModel?.(body) ?? body.model ?? config.defaultModel) as string;

            if (!model) {
                set.status = 400;
                throw new Error("Missing 'model' field in request");
            }

            // Validate required fields
            if (config.requiredFields) {
                for (const field of config.requiredFields) {
                    if (!body[field]) {
                        set.status = 400;
                        throw new Error(`Missing '${field}' field in request`);
                    }
                }
            }

            assertModelAccess(user, token, model, set);
            
            // Extract external metadata and idempotency key
            const headers = (set.headers || {});
            const idempotencyKey = headers['idempotency-key'] || headers['x-idempotency-key'] || body.idempotency_key || body.metadata?.idempotency_key;
            const externalTaskId = headers['x-external-task-id'] || body.external_task_id || body.metadata?.external_task_id;
            const externalUserId = headers['x-external-user-id'] || body.external_user_id || body.metadata?.external_user_id;
            const externalWorkspaceId = headers['x-external-workspace-id'] || body.external_workspace_id || body.metadata?.external_workspace_id;
            const externalFeatureType = headers['x-external-feature-type'] || body.external_feature_type || body.metadata?.external_feature_type;

            log.info(`[${label}] UserID: ${user.id}, Token: ${token.name}, Model: ${model}, TaskID: ${externalTaskId || 'N/A'}`);

            return await UnifiedDispatcher.dispatch({
                model,
                body,
                user,
                token,
                endpointType: config.endpointType,
                skipTransform: false,
                idempotencyKey,
                externalTaskId,
                externalUserId,
                externalWorkspaceId,
                externalFeatureType
            });
        });
}
