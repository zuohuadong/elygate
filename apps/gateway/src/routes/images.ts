import { Elysia } from 'elysia';
import { assertModelAccess } from '../middleware/auth';
import { UnifiedDispatcher } from '../services/dispatcher';

export const imagesRouter = new Elysia()
    .post('/images/generations', async ({ body, token, user, set }: any) => {
        const { model, prompt } = body as Record<string, any>;

        if (!prompt) {
            throw new Error("Missing 'prompt' field in request body");
        }

        const targetModel = model || 'dall-e-3';

        // --- Access Control ---
        assertModelAccess(user, token, targetModel, set);
        // ----------------------

        console.log(`[Images] UserID: ${user.id}, Token: ${token.name}, Model: ${targetModel}`);

        return await UnifiedDispatcher.dispatch({
            model: targetModel,
            body,
            user,
            token,
            endpointType: 'images'
        });
    });
