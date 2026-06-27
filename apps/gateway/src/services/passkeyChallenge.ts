export type PasskeyAction = 'register' | 'verify' | 'login';

export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

type PasskeyChallenge = {
    action: PasskeyAction;
    userId: number;
    expiresAt: number;
};

const passkeyChallenges = new Map<string, PasskeyChallenge>();

export function cleanupPasskeyChallenges(now = Date.now()): void {
    for (const [token, challenge] of passkeyChallenges.entries()) {
        if (challenge.expiresAt <= now) passkeyChallenges.delete(token);
    }
}

export function createPasskeyChallenge(action: PasskeyAction, userId: number, now = Date.now()) {
    cleanupPasskeyChallenges(now);
    const challengeToken = `pkc_${Bun.randomUUIDv7('hex')}`;
    const challenge = Bun.randomUUIDv7('hex');
    passkeyChallenges.set(challengeToken, { action, userId, expiresAt: now + PASSKEY_CHALLENGE_TTL_MS });
    return { challengeToken, challenge };
}

export function consumePasskeyChallenge(token: string, action: PasskeyAction, now = Date.now()) {
    cleanupPasskeyChallenges(now);
    const challenge = passkeyChallenges.get(token);
    if (!challenge || challenge.action !== action || challenge.expiresAt <= now) return null;
    passkeyChallenges.delete(token);
    return challenge;
}

export function clearPasskeyChallenges(): void {
    passkeyChallenges.clear();
}
