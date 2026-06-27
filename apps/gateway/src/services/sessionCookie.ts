export function buildAuthSessionCookieOptions(sessionToken: string, request: Request) {
    return {
        value: sessionToken,
        httpOnly: true,
        secure: request.headers.get('x-forwarded-proto') === 'https',
        sameSite: 'lax' as const,
        maxAge: 7 * 86400,
        path: '/',
    };
}
