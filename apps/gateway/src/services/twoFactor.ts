import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
}

function base32Decode(input: string): Buffer {
    const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (const char of normalized) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) continue;
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

function generateHotp(secret: string, counter: number, digits = 6): string {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buffer.writeUInt32BE(counter >>> 0, 4);
    const key = base32Decode(secret);
    const hmac = createHmac('sha1', key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24)
        | ((hmac[offset + 1] & 0xff) << 16)
        | ((hmac[offset + 2] & 0xff) << 8)
        | (hmac[offset + 3] & 0xff);
    return String(binary % (10 ** digits)).padStart(digits, '0');
}

function hashBackupCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
}

export function generateTwoFactorSecret(): string {
    return base32Encode(randomBytes(20));
}

export function buildOtpAuthUrl(secret: string, accountName: string, issuer: string): string {
    const label = encodeURIComponent(`${issuer}:${accountName}`);
    const query = new URLSearchParams({
        secret,
        issuer,
        algorithm: 'SHA1',
        digits: '6',
        period: '30',
    });
    return `otpauth://totp/${label}?${query.toString()}`;
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
    const normalized = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalized)) return false;
    const currentCounter = Math.floor(Date.now() / 30000);
    for (let offset = -window; offset <= window; offset++) {
        const expected = generateHotp(secret, currentCounter + offset);
        if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) {
            return true;
        }
    }
    return false;
}

export function generateBackupCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
        const raw = randomBytes(5).toString('hex').toUpperCase();
        return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    });
}

export function hashBackupCodes(codes: string[]): string[] {
    return codes.map(hashBackupCode);
}

export function consumeBackupCode(code: string, hashes: string[]): { valid: boolean; remaining: string[] } {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return { valid: false, remaining: hashes };
    const digest = hashBackupCode(normalized);
    const next = [...hashes];
    const index = next.findIndex((item) => {
        try {
            return timingSafeEqual(Buffer.from(item), Buffer.from(digest));
        } catch {
            return item === digest;
        }
    });
    if (index === -1) return { valid: false, remaining: hashes };
    next.splice(index, 1);
    return { valid: true, remaining: next };
}
