import { writable, get } from "svelte/store";

type Currency = "USD" | "RMB";

export interface SessionData {
    id: string;
    token: string;
    username: string;
    role: number;
    currency: Currency;
    exchangeRate: number;
    quotaPerUnit: number;
}

export interface SessionManager {
    subscribe: any;
    update(data: Partial<SessionData>): void;
    setSystemInfo(info: { exchangeRate?: number; quotaPerUnit?: number }): void;
    updateCurrency(currency: Currency): void;
    clear(): void;
    readonly id: string;
    readonly token: string;
    readonly username: string;
    readonly role: number;
    readonly currency: Currency;
    readonly exchangeRate: number;
    readonly quotaPerUnit: number;
    formatQuota(quota: number, precision?: number): string;
}

function createSession(): SessionManager {
    const initial: SessionData = {
        id: typeof window !== "undefined" ? localStorage.getItem("user_id") || "" : "",
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
                id: "",
                token: "",
                username: "",
                role: 0,
                currency: "USD",
                exchangeRate: 7.2,
                quotaPerUnit: 500000,
            });
        },
        get id() {
            return get(store).id;
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
        formatQuota(quota: number, precision: number = 4): string {
            const s = get(store);
            const val = quota / s.quotaPerUnit;
            if (s.currency === "RMB") {
                return `¥${(val * s.exchangeRate).toFixed(precision)}`;
            }
            return `$${val.toFixed(precision)}`;
        }
    };
}

export const session: SessionManager = createSession();
