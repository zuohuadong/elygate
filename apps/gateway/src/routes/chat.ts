import { Elysia, t } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import { ChatService } from '../services/chatService';
import { type TokenRecord, type UserRecord } from '../types';

export const chatRouter = new Elysia()
    .use(authPlugin)
    .post('/chat/completions', async ({ body, token, user, set }: any) => {
        const model = body.model;

        // --- Phase 4 & 6: Access Control ---
        assertModelAccess(user, token, model, set);
        // ------------------------------------------

        return await ChatService.processChat(body, user as UserRecord, token as TokenRecord, set);
    }, {
        body: t.Object({
            model: t.String({ description: 'Model name' }),
            messages: t.Array(t.Any()),
            stream: t.Optional(t.Boolean({ default: false })),
            max_tokens: t.Optional(t.Number({ default: 4096 })),
            temperature: t.Optional(t.Number({ default: 1.0 })),
            presence_penalty: t.Optional(t.Number()),
            frequency_penalty: t.Optional(t.Number()),
            top_p: t.Optional(t.Number()),
            top_k: t.Optional(t.Number()),
            seed: t.Optional(t.Number()),
            stop: t.Optional(t.Any()),
            n: t.Optional(t.Number()),
            user: t.Optional(t.String()),
            // Tool/Function Calling (OpenAI standard)
            tools: t.Optional(t.Array(t.Any())),
            tool_choice: t.Optional(t.Any()),
            functions: t.Optional(t.Array(t.Any())),
            function_call: t.Optional(t.Any()),
            // Misc passthrough
            stream_options: t.Optional(t.Any()),
            system_fingerprint: t.Optional(t.Any()),
            logit_bias: t.Optional(t.Any()),
            logprobs: t.Optional(t.Any()),
            max_completion_tokens: t.Optional(t.Number()),
            thinking: t.Optional(t.Any()),
        }),
        detail: {
            tags: ['Chat (OpenAI)'],
            summary: 'OpenAI Chat Completions API Compatibility',
            description: 'Send chat completions using the OpenAI format.'
        }
    });
