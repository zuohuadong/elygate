import { Elysia } from 'elysia';
import { assertModelAccess } from '../middleware/auth';
import { UnifiedDispatcher, type DispatchOptions } from '../services/dispatcher';

interface ProxyRouteConfig {
    path: string;
    endpointType: DispatchOptions['endpointType'];
    requiredFields?: string[];
    defaultModel?: string;
    /** Extract model name from body (defaults to body.model) */
    getModel?: (body: any) => string | undefined;
}

/**
 * Generic proxy route factory.
 * Eliminates boilerplate for audio/video/images/embeddings/rerank endpoints
 * that all follow the same pattern: validate → access check → dispatch.
 */
export function createProxyRoute(config: ProxyRouteConfig): Elysia {
    const label = config.endpointType.replace('/', '_').toUpperCase();

    return new Elysia()
        .post(config.path, async ({ body, token, user, set }: any) => {
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

            console.log(`[${label}] UserID: ${user.id}, Token: ${token.name}, Model: ${model}`);

            return await UnifiedDispatcher.dispatch({
                model,
                body,
                user,
                token,
                endpointType: config.endpointType,
                skipTransform: false
            });
        });
}
