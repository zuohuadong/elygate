// SvelteKit frontend shared API fetch client
// Encapsulates communication with the gateway backend with credentials

export const API_BASE = 'http://localhost:3000/api';

/**
 * Get the stored admin token from localStorage
 */
function getToken(): string | null {
    if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('admin_token');
    }
    return null;
}

/**
 * Set the admin token for the management panel
 */
export function setToken(token: string) {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('admin_token', token);
    }
}

/**
 * Clear the stored token (logout)
 */
export function clearToken() {
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('admin_token');
    }
}

/**
 * Universal fetch with auth headers and JSON support
 */
export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {})
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
    });

    if (!response.ok) {
        let errorMsg = response.statusText;
        try {
            const errData = await response.json();
            if (errData && errData.message) {
                errorMsg = errData.message;
            } else if (typeof errData === 'string') {
                errorMsg = errData;
            }
        } catch {
            // Ignored
            const text = await response.text();
            if (text) errorMsg = text;
        }
        throw new Error(errorMsg || `Error ${response.status}`);
    }

    return response.json() as Promise<T>;
}
