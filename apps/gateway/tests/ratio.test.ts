import { expect, test, describe } from "bun:test";
import { calculateCost, ModelRatio, GroupRatio, CompletionRatio } from "../src/services/ratio";

describe("Ratio Calculation Engine (New-API Parity)", () => {

    test("Standard GPT-3.5 Request for Default User", () => {
        // modelRatio = 1, groupRatio = 1, completionRatio = 1.33
        // input = 100, output = 200
        // expected: Math.ceil( (100 + 200 * 1.33) * 1 * 1 ) = Math.ceil(366) = 366
        const cost = calculateCost('gpt-3.5-turbo', 'default', 100, 200);
        expect(cost).toBe(366);
    });

    test("GPT-4 Request for VIP User", () => {
        // modelRatio = 15, groupRatio = 0.8, completionRatio = 2
        // input = 150, output = 50
        // expected: Math.ceil( (150 + 50 * 2) * 15 * 0.8 ) = Math.ceil( 250 * 12 ) = 3000
        const cost = calculateCost('gpt-4', 'vip', 150, 50);
        expect(cost).toBe(3000);
    });

    test("Claude-3-Opus Request for SVIP User", () => {
        // modelRatio = 15, groupRatio = 0.6, completionRatio = 5
        // input = 10, output = 10
        // expected: Math.ceil( (10 + 10 * 5) * 15 * 0.6 ) = Math.ceil( 60 * 9 ) = 540
        const cost = calculateCost('claude-3-opus-20240229', 'svip', 10, 10);
        expect(cost).toBe(540);
    });

    test("Fallback to defaults when model or group is missing", () => {
        // unknown_model -> modelRatio=1, cRatio=1
        // input = 100, output = 100
        // expected: Math.ceil( (100 + 100 * 1) * 1 * 1 ) = 200
        const cost = calculateCost('unknown_custom_model', 'unknown_group', 100, 100);
        expect(cost).toBe(200);
    });

});
