<script lang="ts" module>
    /**
     * Global session state using Svelte 5 runes.
     * Persists to localStorage so sessions survive page reloads.
     */
    const STORAGE_KEY = 'elygate_session';

    interface SessionData {
        id: string;
        token: string;
        username: string;
        role: number;
        currency: string;
        user: Record<string, unknown>;
    }

    interface SystemInfo {
        exchangeRate: number;
        quotaPerUnit: number;
    }

    function loadFromStorage(): SessionData {
        if (typeof window === 'undefined') return { id: '', token: '', username: '', role: 0, currency: 'USD', user: null };
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch { /* session parse fallback */ }
        return { id: '', token: '', username: '', role: 0, currency: 'USD', user: null };
    }

    function saveToStorage(data: SessionData) {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { /* session parse fallback */ }
    }

    const initial = loadFromStorage();

    let id = $state(initial.id);
    let token = $state(initial.token);
    let username = $state(initial.username);
    let role = $state(initial.role);
    let currency = $state(initial.currency);
    let user = $state(initial.user);
    let exchangeRate = $state(7.2);
    let quotaPerUnit = $state(500000);

    export const session = {
        get id() { return id; },
        get token() { return token; },
        get username() { return username; },
        get role() { return role; },
        get currency() { return currency; },
        get user() { return user; },
        get exchangeRate() { return exchangeRate; },
        get quotaPerUnit() { return quotaPerUnit; },

        update(data: Partial<SessionData>) {
            if (data.id !== undefined) id = data.id;
            if (data.token !== undefined) token = data.token;
            if (data.username !== undefined) username = data.username;
            if (data.role !== undefined) role = data.role;
            if (data.currency !== undefined) currency = data.currency;
            if (data.user !== undefined) user = data.user;
            saveToStorage({ id, token, username, role, currency, user });
        },

        updateCurrency(newCurrency: string) {
            currency = newCurrency;
            saveToStorage({ id, token, username, role, currency, user });
        },

        setSystemInfo(info: SystemInfo) {
            exchangeRate = info.exchangeRate;
            quotaPerUnit = info.quotaPerUnit;
        },

        formatQuota(quota: number, precision: number = 4): string {
            const val = quota / quotaPerUnit;
            if (currency === "RMB") {
                return `¥${(val * exchangeRate).toFixed(precision)}`;
            }
            return `$${val.toFixed(precision)}`;
        },

        clear() {
            id = '';
            token = '';
            username = '';
            role = 0;
            currency = 'USD';
            user = null;
            if (typeof window !== 'undefined') {
                localStorage.removeItem(STORAGE_KEY);
            }
        }
    };
</script>
