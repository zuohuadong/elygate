<script lang="ts" module>
    /**
     * Global session state using Svelte 5 runes.
     * Persists to localStorage so sessions survive page reloads.
     */
    const STORAGE_KEY = 'elygate_session';

    interface SessionData {
        token: string;
        username: string;
        role: number;
        currency: string;
    }

    interface SystemInfo {
        exchangeRate: number;
        quotaPerUnit: number;
    }

    function loadFromStorage(): SessionData {
        if (typeof window === 'undefined') return { token: '', username: '', role: 0, currency: 'USD' };
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch {}
        return { token: '', username: '', role: 0, currency: 'USD' };
    }

    function saveToStorage(data: SessionData) {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {}
    }

    const initial = loadFromStorage();

    let token = $state(initial.token);
    let username = $state(initial.username);
    let role = $state(initial.role);
    let currency = $state(initial.currency);
    let exchangeRate = $state(7.2);
    let quotaPerUnit = $state(500000);

    export const session = {
        get token() { return token; },
        get username() { return username; },
        get role() { return role; },
        get currency() { return currency; },
        get exchangeRate() { return exchangeRate; },
        get quotaPerUnit() { return quotaPerUnit; },

        update(data: Partial<SessionData>) {
            if (data.token !== undefined) token = data.token;
            if (data.username !== undefined) username = data.username;
            if (data.role !== undefined) role = data.role;
            if (data.currency !== undefined) currency = data.currency;
            saveToStorage({ token, username, role, currency });
        },

        updateCurrency(newCurrency: string) {
            currency = newCurrency;
            saveToStorage({ token, username, role, currency });
        },

        setSystemInfo(info: SystemInfo) {
            exchangeRate = info.exchangeRate;
            quotaPerUnit = info.quotaPerUnit;
        },

        clear() {
            token = '';
            username = '';
            role = 0;
            currency = 'USD';
            if (typeof window !== 'undefined') {
                localStorage.removeItem(STORAGE_KEY);
            }
        }
    };
</script>
