import { Elysia } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import { UnifiedDispatcher } from '../services/dispatcher';

export const videoRouter = new Elysia()
    .use(authPlugin)
    .post('/video/generations', async ({ body, token, user, set }: any) => {
        const { model, prompt } = body;
        if (!model || !prompt) {
            set.status = 400;
            throw new Error("Missing model or prompt");
        }

        // --- Access Control ---
        assertModelAccess(user, token, model, set);
        // ----------------------

        console.log(`[Video] UserID: ${user.id}, Token: ${token.name}, Model: ${model}`);

        return await UnifiedDispatcher.dispatch({
            model,
            body,
            user,
            token,
            endpointType: 'video'
        });
    });
