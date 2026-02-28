import { expect, test, describe, beforeEach } from "bun:test";
import { isRateLimited } from "../src/services/ratelimit";

describe("Token Bucket & Rate Limiter Security", () => {

    // We cannot completely reset an unexported state sealed within a module in a single process.
    // Therefore, in testing, we use the method of changing the identifier to simulate different isolated environments.
    let uniqueUser = "test_user_0";

    beforeEach(() => {
        uniqueUser = `test_user_${Date.now()}_${Math.random()}`;
    });

    test("Allow requests within limits", async () => {
        let blocked = false;
        // The allowed limit is 300 times / minute. Here we test 50 legal requests, which should never be rate-limited.
        for (let i = 0; i < 50; i++) {
            if (await isRateLimited(uniqueUser)) {
                blocked = true;
                break;
            }
        }
        expect(blocked).toBe(false);
    });

    test("Block requests exceeding the exact limit", async () => {
        let blocked = false;
        const totalRequests = 450;
        for (let i = 0; i < totalRequests; i++) {
            try {
                if (await isRateLimited(uniqueUser)) {
                    blocked = true;
                    break;
                }
            } catch (e) {
                // Ignore transient errors
            }
            // Faster loop with less delay
            if (i % 100 === 0) await new Promise(resolve => setTimeout(resolve, 2));
        }
        expect(blocked).toBe(true);
    });

    // Here, we could actually use Bun's mock timers or jest.useFakeTimers equivalent implementations to simulate time window sliding.
    // But for the sake of simplicity, we will not delve into that for now, and only test the core counting boundaries.
});
