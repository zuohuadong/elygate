import { Elysia } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import { UnifiedDispatcher } from '../services/dispatcher';

export const rerankRouter = new Elysia()
    .use(authPlugin)
    .post('/rerank', async ({ body, token, user, set }: any) => {
        const { model, query, documents } = body;
        if (!model || !query || !documents) {
            set.status = 400;
            throw new Error("Missing model, query, or documents");
        }

        // --- Access Control ---
        assertModelAccess(user, token, model, set);
        // ----------------------

        console.log(`[Rerank] UserID: ${user.id}, Token: ${token.name}, Model: ${model}`);

        return await UnifiedDispatcher.dispatch({
            model,
            body,
            user,
            token,
            endpointType: 'rerank'
        });
    });
