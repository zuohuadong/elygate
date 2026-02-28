import { expect, test, describe, beforeEach } from "bun:test";
import { isRateLimited } from "../src/services/ratelimit";

describe("Token Bucket & Rate Limiter Security", () => {

    // 我们没法在一个进程里彻底重置一个模块内封死的不导出 state 
    // 所以在测试中，采用改变 identifier 的方式模拟不同的隔离环境
    let uniqueUser = "test_user_0";

    beforeEach(() => {
        uniqueUser = `test_user_${Date.now()}_${Math.random()}`;
    });

    test("Allow requests within limits", () => {
        let blocked = false;
        // 允许的上限是 300 次 / 分钟。这里测试合法请求 50 次，绝不应该被限频
        for (let i = 0; i < 50; i++) {
            if (isRateLimited(uniqueUser)) {
                blocked = true;
                break;
            }
        }
        expect(blocked).toBe(false);
    });

    test("Block requests exceeding the exact limit", () => {
        // 先发送正常通过的 299 次
        for (let i = 0; i < 299; i++) {
            expect(isRateLimited(uniqueUser)).toBe(false);
        }

        // 第 300 次，由于记录的是在 300 次之前的状态，仍然可以通过 (存入第300条记录)
        expect(isRateLimited(uniqueUser)).toBe(false);

        // 第 301 次，应当触发限流！
        expect(isRateLimited(uniqueUser)).toBe(true);
    });

    // 这里其实还可以通过 Bun 的 mock timers 或者使用 jest.useFakeTimers 同等实现去模拟时间窗口划过
    // 但为求精简，我们暂不深入，测试核心的计数边界即可。
});
