import { expect, test, describe, beforeAll } from "bun:test";
import { memoryCache } from "../src/services/cache";

/**
 * Model Mapping & Routing Parity Test
 * Ensures that requests are correctly mapped to upstream specific models.
 */
describe("Logic Parity: Model Mapping", () => {

    beforeAll(async () => {
        // Mock the internal Map in memoryCache
        const routes = new Map<string, any[]>();

        const openAIChannel = {
            id: 1,
            type: 1, // OPENAI
            models: ["gpt-3.5-turbo", "gpt-4"],
            model_mapping: { "gpt-3.5-turbo": "gpt-3.5-turbo-0125" },
            weight: 1,
            status: 1
        };

        const geminiChannel = {
            id: 2,
            type: 23, // GEMINI
            models: ["gpt-4"],
            model_mapping: { "gpt-4": "gemini-1.5-pro" },
            weight: 1,
            status: 1
        };

        routes.set("gpt-3.5-turbo", [openAIChannel]);
        routes.set("gpt-4", [openAIChannel, geminiChannel]);

        (memoryCache as any).channelRoutes = routes;
    });

    test("Channel Selection and Priority", () => {
        const selected = memoryCache.selectChannels("gpt-4");
        expect(selected.length).toBe(2);
        expect(selected.map(c => c.id)).toContain(1);
        expect(selected.map(c => c.id)).toContain(2);
    });

    test("Mock Mapping Application logic", () => {
        // This test simulates the logic inside chat.ts to ensure 
        // the mapping works as expected for different channels.

        const gpt4Channels = memoryCache.selectChannels("gpt-4");

        // Find Gemini channel (ID 2)
        const gemini = gpt4Channels.find(c => c.id === 2);
        expect(gemini).toBeDefined();

        let upstreamModel = "gpt-4";
        if (gemini?.model_mapping && (gemini.model_mapping as any)["gpt-4"]) {
            upstreamModel = (gemini.model_mapping as any)["gpt-4"];
        }

        expect(upstreamModel).toBe("gemini-1.5-pro");
    });
});
