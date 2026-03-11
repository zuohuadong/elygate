// SvelteKit frontend shared API fetch client
// Encapsulates communication with the gateway backend with credentials

// Derive API_BASE from the current window location to support remote deployments
export const API_BASE = '/api';


/**
 * Perform sign out and clear local session state
 */
export async function clearToken() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) { }
}

/**
 * Universal fetch with auth headers and JSON support
 */
export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {})
    };

    const baseUrl = endpoint.startsWith('/v1') ? '' : API_BASE;
    const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include' // Allow sending HttpOnly better-auth cookies
    });

    if (!response.ok) {
        let errorMsg = response.statusText;
        try {
            // Clone the response so we can try multiple ways of reading it
            const clonedResponse = response.clone();
            try {
                const errData = await clonedResponse.json();
                if (errData && errData.message) {
                    errorMsg = errData.message;
                } else if (typeof errData === 'string') {
                    errorMsg = errData;
                }
            } catch {
                const text = await response.text();
                if (text) errorMsg = text;
            }
        } catch {
            // Ultimate fallback
        }
        throw new Error(errorMsg || `Error ${response.status}`);
    }

    return response.json() as Promise<T>;
}
