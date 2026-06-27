import { describe, expect, test } from 'bun:test';
import {
    buildOtpAuthUrl,
    consumeBackupCode,
    generateBackupCodes,
    generateTwoFactorSecret,
    hashBackupCodes,
} from './twoFactor';

describe('two-factor compatibility helpers', () => {
    test('builds otpauth urls for authenticator enrollment', () => {
        const secret = generateTwoFactorSecret();
        const url = buildOtpAuthUrl(secret, 'user@example.test', 'Elygate');

        expect(secret).toMatch(/^[A-Z2-7]+$/);
        expect(url).toContain('otpauth://totp/Elygate%3Auser%40example.test?');
        expect(url).toContain(`secret=${secret}`);
        expect(url).toContain('issuer=Elygate');
    });

    test('hashes and consumes backup codes exactly once', () => {
        const [code] = generateBackupCodes(1);
        const hashes = hashBackupCodes([code]);

        const first = consumeBackupCode(code.toLowerCase(), hashes);
        expect(first.valid).toBe(true);
        expect(first.remaining).toHaveLength(0);

        const second = consumeBackupCode(code, first.remaining);
        expect(second.valid).toBe(false);
    });
});
