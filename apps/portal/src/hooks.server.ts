import type { Handle } from '@sveltejs/kit';
import { sql } from '$lib/server/db';

// Basic in-memory rate limiter with periodic cleanup to prevent memory leaks
const rateLimits = new Map<string, { count: number, lastReset: number }>();
const LIMIT = 100; // requests
const WINDOW = 60 * 1000; // 1 minute

// Cleanup interval to prevent memory leak
if (typeof setInterval !== 'undefined') {
    setInterval(() => {
        const now = Date.now();
        for (const [ip, bucket] of rateLimits.entries()) {
            if (now - bucket.lastReset > WINDOW * 2) {
                rateLimits.delete(ip);
            }
        }
    }, WINDOW * 5); // Clean up every 5 minutes
}

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Rate Limiting
    const ip = event.getClientAddress();
    const now = Date.now();
    const bucket = rateLimits.get(ip) || { count: 0, lastReset: now };

    if (now - bucket.lastReset > WINDOW) {
        bucket.count = 0;
        bucket.lastReset = now;
    }

    bucket.count++;
    rateLimits.set(ip, bucket);

    if (bucket.count > LIMIT) {
        return new Response('Too Many Requests', { status: 429 });
    }

    // 2. Session / Context
    const sessionToken = event.cookies.get('auth_session');
    if (sessionToken) {
        const [session] = await sql`
            SELECT s.user_id, u.username, u.role, u.org_id, o.name as org_name
            FROM session s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN organizations o ON u.org_id = o.id
            WHERE s.token = ${sessionToken} AND s.expires_at > NOW()
            LIMIT 1
        `;

    if (session) {
        (event.locals as any).user = {
            id: session.user_id,
            username: session.username,
            role: session.role
        };
        if (session.org_id) {
            (event.locals as any).org = {
                id: session.org_id,
                name: session.org_name
            };
        }
    }
    }

    const response = await resolve(event);

    // 3. Security Headers
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';");

    return response;
};
