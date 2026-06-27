export function buildOAuthCallbackRedirect(input: {
    webUrl?: string | null;
    token: string;
    username: string;
    role: number | string;
}): string {
    const base = (input.webUrl || 'http://localhost:5173').replace(/\/+$/, '');
    const params = new URLSearchParams({
        token: input.token,
        username: input.username,
        role: String(input.role),
    });
    return `${base}/auth/callback?${params.toString()}`;
}
