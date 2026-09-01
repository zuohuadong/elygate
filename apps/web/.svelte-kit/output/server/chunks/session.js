//#region src/lib/session.svelte
var STORAGE_KEY = "elygate_session";
function loadFromStorage() {
	if (typeof window === "undefined") return {
		id: "",
		token: "",
		username: "",
		role: 0,
		currency: "USD",
		user: null
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return {
		id: "",
		token: "",
		username: "",
		role: 0,
		currency: "USD",
		user: null
	};
}
function saveToStorage(data) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {}
}
var initial = loadFromStorage();
var id = initial.id;
var token = initial.token;
var username = initial.username;
var role = initial.role;
var currency = initial.currency;
var user = initial.user;
var exchangeRate = 7.2;
var quotaPerUnit = 5e5;
var session = {
	get id() {
		return id;
	},
	get token() {
		return token;
	},
	get username() {
		return username;
	},
	get role() {
		return role;
	},
	get currency() {
		return currency;
	},
	get user() {
		return user;
	},
	get exchangeRate() {
		return exchangeRate;
	},
	get quotaPerUnit() {
		return quotaPerUnit;
	},
	update(data) {
		if (data.id !== void 0) id = data.id;
		if (data.token !== void 0) token = data.token;
		if (data.username !== void 0) username = data.username;
		if (data.role !== void 0) role = data.role;
		if (data.currency !== void 0) currency = data.currency;
		if (data.user !== void 0) user = data.user;
		saveToStorage({
			id,
			token,
			username,
			role,
			currency,
			user
		});
	},
	updateCurrency(newCurrency) {
		currency = newCurrency;
		saveToStorage({
			id,
			token,
			username,
			role,
			currency,
			user
		});
	},
	setSystemInfo(info) {
		exchangeRate = info.exchangeRate;
		quotaPerUnit = info.quotaPerUnit;
	},
	formatQuota(quota, precision = 4) {
		const val = quota / quotaPerUnit;
		if (currency === "RMB") return `¥${(val * exchangeRate).toFixed(precision)}`;
		return `$${val.toFixed(precision)}`;
	},
	clear() {
		id = "";
		token = "";
		username = "";
		role = 0;
		currency = "USD";
		user = null;
		if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
	}
};
//#endregion
export { session as t };
