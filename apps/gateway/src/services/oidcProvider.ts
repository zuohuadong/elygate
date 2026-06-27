type FetchLike = typeof fetch;

export type OidcProviderConfig = {
    providerName: string;
    tokenEndpoint: string;
    userinfoEndpoint: string;
    clientId: string;
    clientSecret: string;
};

export async function exchangeOidcAuthorizationCode(
    provider: OidcProviderConfig,
    code: string,
    redirectUri: string,
    fetcher: FetchLike = fetch,
): Promise<Record<string, unknown>> {
    if (!provider.tokenEndpoint) throw new Error('tokenEndpoint is required');
    if (!code) throw new Error('code is required');

    const response = await fetcher(provider.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: provider.clientId,
            client_secret: provider.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.error) {
        throw new Error(String(payload.error_description || payload.error || `OIDC token endpoint returned ${response.status}`));
    }
    if (!payload.access_token) throw new Error('OIDC token response is missing access_token');
    return payload;
}

export async function fetchOidcUserInfo(
    provider: Pick<OidcProviderConfig, 'userinfoEndpoint'>,
    accessToken: string,
    fetcher: FetchLike = fetch,
): Promise<Record<string, unknown>> {
    if (!provider.userinfoEndpoint) throw new Error('userinfoEndpoint is required');
    if (!accessToken) throw new Error('access_token is required');

    const response = await fetcher(provider.userinfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.error) {
        throw new Error(String(payload.error_description || payload.error || `OIDC userinfo endpoint returned ${response.status}`));
    }
    return payload;
}

export function normalizeOidcUserProfile(providerName: string, profile: Record<string, unknown>) {
    const providerUserId = String(profile.sub || profile.id || '');
    if (!providerUserId) throw new Error('OIDC profile is missing subject');
    const display = profile.email || profile.preferred_username || profile.name || providerUserId;
    return {
        provider: `oidc:${providerName}`,
        providerUserId,
        username: `oidc:${providerName}:${display}`,
        email: typeof profile.email === 'string' ? profile.email : null,
        rawProfile: profile,
    };
}
