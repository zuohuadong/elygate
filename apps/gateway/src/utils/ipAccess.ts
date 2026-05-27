function normalizeIp(value: string): string {
    return value.trim().replace(/^\[|\]$/g, '');
}

export function getClientIpFromHeaders(headers: Headers): string {
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const [first] = forwarded.split(',');
        if (first?.trim()) return normalizeIp(first);
    }
    return normalizeIp(headers.get('x-real-ip') || '127.0.0.1');
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let result = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const value = Number(part);
        if (value < 0 || value > 255) return null;
        result = (result << 8) + value;
    }
    return result >>> 0;
}

function isIpv4CidrMatch(ip: string, cidr: string): boolean {
    const [range, prefixRaw] = cidr.split('/');
    const prefix = Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const ipInt = ipv4ToInt(ip);
    const rangeInt = ipv4ToInt(range);
    if (ipInt === null || rangeInt === null) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (rangeInt & mask);
}

export function isIpAllowed(clientIp: string, policy: string | null | undefined): boolean {
    const ip = normalizeIp(clientIp);
    const entries = String(policy || '')
        .split(',')
        .map((entry) => normalizeIp(entry))
        .filter(Boolean);

    if (entries.length === 0) return true;

    return entries.some((entry) => {
        if (entry === '*') return true;
        if (entry.includes('/')) return isIpv4CidrMatch(ip, entry);
        return entry === ip;
    });
}
