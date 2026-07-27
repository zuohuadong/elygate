import { expect, test, describe } from "bun:test";
import { AnthropicConverter, GeminiConverter, OpenAIConverter, AliConverter, BaiduConverter } from "../src/services/converters";

describe("Unified Converters", () => {
    test("Anthropic Request -> Internal", () => {
        const converter = AnthropicConverter;
        const body = {
            model: "claude-3-sonnet",
            max_tokens: 1024,
            messages: [{ role: "user", content: "hello" }],
            system: "be helpful"
        };
        const internal = converter.convertRequest(body);
        expect(internal.model).toBe("claude-3-sonnet");
        expect(internal.messages).toHaveLength(2);
        expect((internal.messages[0] as any).role).toBe("system");
        expect((internal.messages[1] as any).content).toBe("hello");
    });

    test("Internal Response -> Anthropic", () => {
        const converter = AnthropicConverter;
        const internalRes = {
            id: "123",
            object: "chat.completion",
            created: 12345,
            model: "test-model",
            choices: [{
                message: { role: "assistant", content: "hi there" },
                finish_reason: "stop"
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        };
        const anthropic = converter.convertResponse(internalRes) as any;
        expect(anthropic.type).toBe("message");
        expect(anthropic.content[0].text).toBe("hi there");
        expect(anthropic.usage.input_tokens).toBe(10);
    });

    test("Gemini Request -> Internal", () => {
        const converter = GeminiConverter;
        const body = {
            contents: [{ role: "user", parts: [{ text: "hi" }] }],
            generationConfig: { temperature: 0.5 }
        };
        const internal = converter.convertRequest(body);
        expect((internal.messages[0] as any).content).toBe("hi");
        expect(internal.temperature).toBe(0.5);
    });

    test("Internal Response -> Gemini", () => {
        const converter = GeminiConverter;
        const internalRes = {
            choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        } as any;
        const gemini = converter.convertResponse(internalRes) as any;
        expect(gemini.candidates[0].content.parts[0].text).toBe("hello");
        expect(gemini.usageMetadata.totalTokenCount).toBe(2);
    });

    test("Ali Request -> Internal", () => {
        const converter = AliConverter;
        const body = {
            model: "qwen-max",
            input: { messages: [{ role: "user", content: "hello" }] },
            parameters: { temperature: 0.7 }
        };
        const internal = converter.convertRequest(body);
        expect(internal.model).toBe("qwen-max");
        expect((internal.messages[0] as any).content).toBe("hello");
        expect(internal.temperature).toBe(0.7);
    });

    test("Baidu Request -> Internal", () => {
        const converter = BaiduConverter;
        const body = {
            messages: [{ role: "user", content: "hey" }],
            temperature: 0.9
        };
        const internal = converter.convertRequest(body);
        expect((internal.messages[0] as any).content).toBe("hey");
        expect(internal.temperature).toBe(0.9);
    });
});
