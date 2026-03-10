import { Elysia } from 'elysia';
import { assertModelAccess } from '../middleware/auth';
import { UnifiedDispatcher } from '../services/dispatcher';

export const embeddingsRouter = new Elysia()
    .post('/embeddings', async ({ body, token, user, set }: any) => {
        const { model, input } = body as Record<string, any>;

        if (!model) {
            throw new Error("Missing 'model' field in request body");
        }

        if (!input) {
            throw new Error("Missing 'input' field in request body");
        }

        // --- Access Control ---
        assertModelAccess(user, token, model, set);
        // ----------------------

        console.log(`[Embeddings Request] UserID: ${user.id}, Token: ${token.name}, Model: ${model}`);

        return await UnifiedDispatcher.dispatch({
            model,
            body,
            user: user as any,
            token: token as any,
            endpointType: 'embeddings'
        });
    });
