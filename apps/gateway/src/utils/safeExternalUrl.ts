import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
    'localhost',
    'metadata.google.internal',
]);

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return (
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 0) ||
        (a >= 224)
    );
}

function isBlockedHostname(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return true;
    if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
    return isPrivateIp(host);
}

function isPrivateIpv6(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === '::' || host === '::1') return true;
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
    if (host.startsWith('::ffff:')) return isPrivateIpv4(host.slice('::ffff:'.length));
    return false;
}

function isPrivateIp(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const family = isIP(host);
    if (family === 4) return isPrivateIpv4(host);
    if (family === 6) return isPrivateIpv6(host);
    return false;
}

export function assertSafeExternalUrl(value: string): URL {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only HTTP(S) URLs are allowed');
    }
    if (url.username || url.password) {
        throw new Error('URL credentials are not allowed');
    }
    if (isBlockedHostname(url.hostname)) {
        throw new Error(`Refusing to fetch internal or metadata host: ${url.hostname}`);
    }
    return url;
}

export async function safeExternalFetch(value: string, init?: RequestInit): Promise<Response> {
    const url = assertSafeExternalUrl(value);
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.some((address) => isPrivateIp(address.address))) {
        throw new Error(`Refusing to fetch host resolving to internal address: ${url.hostname}`);
    }
    return fetch(url.toString(), {
        redirect: 'manual',
        ...init,
    });
}
