import { writable, get } from "svelte/store";

type Currency = "USD" | "RMB";

interface SessionData {
    token: string;
    username: string;
    role: number;
    currency: Currency;
    exchangeRate: number;
    quotaPerUnit: number;
}

function createSession() {
    const initial: SessionData = {
        token: typeof window !== "undefined" ? localStorage.getItem("token") || "" : "",
        username: typeof window !== "undefined" ? localStorage.getItem("username") || "" : "",
        role: typeof window !== "undefined" ? parseInt(localStorage.getItem("role") || "0") : 0,
        currency: (typeof window !== "undefined" ? localStorage.getItem("currency") : "USD") as Currency || "USD",
        exchangeRate: 7.2,
        quotaPerUnit: 500000,
    };

    const store = writable<SessionData>(initial);
    const { subscribe, set, update } = store;

    return {
        subscribe,
        update: (data: Partial<SessionData>) => {
            update((s) => {
                const newState = { ...s, ...data };
                if (typeof window !== "undefined") {
                    if (data.token !== undefined) localStorage.setItem("token", data.token);
                    if (data.username !== undefined) localStorage.setItem("username", data.username);
                    if (data.role !== undefined) localStorage.setItem("role", String(data.role));
                    if (data.currency !== undefined) localStorage.setItem("currency", data.currency);
                }
                return newState;
            });
        },
        setSystemInfo: (info: { exchangeRate?: number; quotaPerUnit?: number }) => {
            update((s) => ({ ...s, ...info }));
        },
        updateCurrency: (currency: Currency) => {
            update((s) => {
                if (typeof window !== "undefined") {
                    localStorage.setItem("currency", currency);
                }
                return { ...s, currency };
            });
        },
        clear: () => {
            if (typeof window !== "undefined") {
                localStorage.removeItem("token");
                localStorage.removeItem("username");
                localStorage.removeItem("role");
                localStorage.removeItem("currency");
            }
            set({
                token: "",
                username: "",
                role: 0,
                currency: "USD",
                exchangeRate: 7.2,
                quotaPerUnit: 500000,
            });
        },
        get token() {
            return get(store).token;
        },
        get role() {
            return get(store).role;
        },
        get username() {
            return get(store).username;
        },
        get currency(): Currency {
            return get(store).currency as Currency;
        },
        get exchangeRate() {
            return get(store).exchangeRate;
        },
        get quotaPerUnit() {
            return get(store).quotaPerUnit;
        },
    };
}

export const session = createSession();
