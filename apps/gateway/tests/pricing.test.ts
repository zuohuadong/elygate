import { expect, test, describe, beforeAll } from "bun:test";
import { calculateCost } from "../src/services/ratio";
import { optionCache } from "../src/services/optionCache";

/**
 * Dynamic Pricing Logic Parity Test
 * Verifies that the math matches "New API" standards even without a live DB.
 */
describe("Logic Parity: Dynamic Pricing", () => {

    beforeAll(() => {
        // Ensure options Map is initialized for test
        (optionCache as any).options = new Map();

        // Manually seed the optionCache to simulate DB-loaded values
        optionCache.options.set('ModelRatio', {
            "gpt-4": 15,
            "gpt-3.5-turbo": 1,
            "claude-3-opus": 30
        });
        optionCache.options.set('CompletionRatio', {
            "gpt-4": 2,
            "gpt-3.5-turbo": 1.33
        });
        optionCache.options.set('GroupRatio', {
            "vip": 0.8,
            "svip": 0.6,
            "default": 1
        });
    });

    test("Standard Quota Calculation (New API Formula)", () => {
        // Formula: ceil((prompt + completion * cRatio) * mRatio * gRatio)

        // GPT-3.5 Default: (100 + 100 * 1.33) * 1 * 1 = 233
        const cost1 = calculateCost('gpt-3.5-turbo', 'default', 100, 100);
        expect(cost1).toBe(233);

        // GPT-4 VIP: (100 + 100 * 2) * 15 * 0.8 = 300 * 12 = 3600
        const cost2 = calculateCost('gpt-4', 'vip', 100, 100);
        expect(cost2).toBe(3600);

        // SVIP Discount: (100 + 100 * 2) * 15 * 0.6 = 300 * 9 = 2700
        const cost3 = calculateCost('gpt-4', 'svip', 100, 100);
        expect(cost3).toBe(2700);
    });

    test("Fallback Mechanism", () => {
        // Unknown model should use ratio 1
        // (100 + 100 * 1) * 1 * 1 = 200
        const cost = calculateCost('unknown-model', 'default', 100, 100);
        expect(cost).toBe(200);
    });
});
