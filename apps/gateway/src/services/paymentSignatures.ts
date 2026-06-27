export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
    if (!secret) return false;
    const parts = signatureHeader.split(',').reduce((acc: Record<string, string>, part: string) => {
        const [key, value] = part.split('=');
        if (key && value) acc[key] = value;
        return acc;
    }, {});
    if (!parts.t || !parts.v1) return false;
    const expectedSig = new Bun.CryptoHasher('sha256', secret)
        .update(`${parts.t}.${rawBody}`)
        .digest('hex');
    return expectedSig === parts.v1;
}

export function generateEPaySign(params: string, secret: string): string {
    return new Bun.CryptoHasher('md5').update(params + secret).digest('hex');
}
