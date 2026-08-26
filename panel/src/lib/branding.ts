export const DEFAULT_APP_NAME = "AI 网关";
export const DEFAULT_SHORT_NAME = "AI 网关";
export const DEFAULT_EN_NAME = "gateway";
export const APP_NAME_CACHE_KEY = "app-brand-name";
export const APP_SHORT_NAME_CACHE_KEY = "app-brand-short-name";
export const APP_EN_NAME_CACHE_KEY = "app-brand-en-name";
export const APP_LOGO_CACHE_KEY = "app-brand-logo";
export const APP_FAVICON_CACHE_KEY = "app-brand-favicon";

let currentAppName = DEFAULT_APP_NAME;
let currentShortName = DEFAULT_SHORT_NAME;
let currentEnName = DEFAULT_EN_NAME;
let currentLogoUrl = "";
let currentFaviconUrl = "";

const listeners = new Set<(name: string) => void>();

function safeGetEnv(key: string): string {
	const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	const val =
		proc?.env?.[key] ||
		(typeof import.meta !== "undefined" && import.meta.env
			? (import.meta.env[key] as string | undefined)
			: "") ||
		"";
	return typeof val === "string" ? val.trim() : "";
}

export function getEnvAppName(): string {
	return (
		safeGetEnv("APP_NAME") ||
		safeGetEnv("BRAND_NAME") ||
		safeGetEnv("PLATFORM_NAME") ||
		safeGetEnv("VITE_APP_NAME") ||
		safeGetEnv("VITE_BRAND_NAME") ||
		safeGetEnv("ELYGATE_APP_NAME") ||
		safeGetEnv("BIFROST_APP_NAME")
	);
}

export function getEnvShortName(): string {
	return (
		safeGetEnv("APP_SHORT_NAME") ||
		safeGetEnv("BRAND_SHORT_NAME") ||
		safeGetEnv("SHORT_NAME") ||
		safeGetEnv("VITE_APP_SHORT_NAME")
	);
}

export function getEnvEnName(): string {
	return (
		safeGetEnv("APP_EN_NAME") ||
		safeGetEnv("BRAND_EN_NAME") ||
		safeGetEnv("PLATFORM_EN_NAME") ||
		safeGetEnv("EN_NAME") ||
		safeGetEnv("VITE_APP_EN_NAME")
	);
}

export function getEnvLogo(): string {
	return (
		safeGetEnv("APP_LOGO") ||
		safeGetEnv("BRAND_LOGO") ||
		safeGetEnv("APP_LOGO_URL") ||
		safeGetEnv("BRAND_LOGO_URL") ||
		safeGetEnv("LOGO_URL") ||
		safeGetEnv("VITE_APP_LOGO")
	);
}

export function getEnvFavicon(): string {
	return (
		safeGetEnv("APP_FAVICON") ||
		safeGetEnv("BRAND_FAVICON") ||
		safeGetEnv("APP_FAVICON_URL") ||
		safeGetEnv("FAVICON_URL") ||
		safeGetEnv("VITE_APP_FAVICON")
	);
}

function safeGetStorage(key: string, fallback: string): string {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			const v = window.localStorage.getItem(key) || window.localStorage.getItem(key.replace(/^app-brand-/, 'app-'));
			if (v && typeof v === "string" && v.trim()) return v.trim();
		}
	} catch {}
	return fallback;
}

function safeSetStorage(key: string, value: string | undefined | null): void {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			if (value && typeof value === "string" && value.trim()) {
				window.localStorage.setItem(key, value.trim());
			} else {
				window.localStorage.removeItem(key);
			}
		}
	} catch {}
}

export function getCachedAppName(): string {
	return getEnvAppName() || safeGetStorage(APP_NAME_CACHE_KEY, DEFAULT_APP_NAME);
}

export function getCachedShortName(): string {
	return getEnvShortName() || safeGetStorage(APP_SHORT_NAME_CACHE_KEY, getAppName());
}

export function getCachedEnName(): string {
	return getEnvEnName() || safeGetStorage(APP_EN_NAME_CACHE_KEY, DEFAULT_EN_NAME);
}

export function getCachedLogo(): string {
	return getEnvLogo() || safeGetStorage(APP_LOGO_CACHE_KEY, "");
}

export function getCachedFavicon(): string {
	return getEnvFavicon() || safeGetStorage(APP_FAVICON_CACHE_KEY, "");
}

export function getAppName(): string {
	return currentAppName || getCachedAppName();
}

export function getShortName(): string {
	return currentShortName || getCachedShortName();
}

export function getEnName(): string {
	return currentEnName || getCachedEnName();
}

export function getAppLogo(): string {
	return currentLogoUrl || getCachedLogo();
}

export function getFavicon(): string {
	return currentFaviconUrl || getCachedFavicon();
}

export function setAppLogo(url: string | undefined | null): string {
	const resolved =
		url && typeof url === "string" && url.trim()
			? url.trim()
			: getEnvLogo() || getCachedLogo();
	currentLogoUrl = resolved;
	safeSetStorage(APP_LOGO_CACHE_KEY, resolved);
	if (typeof document !== "undefined" && document.documentElement) {
		if (resolved) {
			const cssVal = resolved.startsWith('url(') ? resolved : 'url(' + JSON.stringify(resolved) + ')';
			document.documentElement.style.setProperty("--app-logo", cssVal);
		} else {
			document.documentElement.style.removeProperty("--app-logo");
		}
	}
	return resolved;
}

export function setFavicon(url: string | undefined | null): string {
	const resolved =
		url && typeof url === "string" && url.trim()
			? url.trim()
			: getEnvFavicon() || getCachedFavicon() || currentLogoUrl;
	currentFaviconUrl = resolved;
	safeSetStorage(APP_FAVICON_CACHE_KEY, resolved);
	if (typeof document !== "undefined" && resolved) {
		let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
		if (!link) {
			link = document.createElement("link");
			link.rel = "icon";
			document.head.appendChild(link);
		}
		link.href = resolved;
	}
	return resolved;
}

export function setShortName(name: string | undefined | null): string {
	const resolved =
		name && typeof name === "string" && name.trim()
			? name.trim()
			: getEnvShortName() || getCachedShortName();
	currentShortName = resolved;
	safeSetStorage(APP_SHORT_NAME_CACHE_KEY, resolved);
	return resolved;
}

export function setEnName(name: string | undefined | null): string {
	const resolved =
		name && typeof name === "string" && name.trim()
			? name.trim()
			: getEnvEnName() || getCachedEnName();
	currentEnName = resolved;
	safeSetStorage(APP_EN_NAME_CACHE_KEY, resolved);
	return resolved;
}

export function setAppName(name: string | undefined | null): string {
	const resolved =
		name && typeof name === "string" && name.trim()
			? name.trim()
			: getEnvAppName() || getCachedAppName();
	currentAppName = resolved;
	safeSetStorage(APP_NAME_CACHE_KEY, resolved);
	if (typeof document !== "undefined") {
		const currentTitle = document.title;
		if (
			!currentTitle ||
			currentTitle === "Elygate" ||
			currentTitle === "Elygate 管理台" ||
			currentTitle === "管理台" ||
			currentTitle === "AI 网关 管理台" ||
			currentTitle === "Bifrost"
		) {
			document.title = resolved + " 管理台";
		} else if (currentTitle.includes("Elygate")) {
			document.title = currentTitle.replace(/Elygate/g, resolved);
		} else if (currentTitle.includes("Bifrost")) {
			document.title = currentTitle.replace(/Bifrost/g, resolved);
		}
	}
	listeners.forEach((fn) => fn(resolved));
	return resolved;
}

export function onAppNameChange(fn: (name: string) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function resolveBranding(config?: Record<string, unknown> | null): {
	appName: string;
	shortName: string;
	enName: string;
	logoUrl: string;
	faviconUrl: string;
} {
	if (!config) {
		return {
			appName: getAppName(),
			shortName: getShortName(),
			enName: getEnName(),
			logoUrl: getAppLogo(),
			faviconUrl: getFavicon(),
		};
	}
	const clientConfig = config.client_config as Record<string, unknown> | undefined;
	const metadata = config.metadata as Record<string, unknown> | undefined;

	const fromConfigName =
		(typeof config.app_name === "string" && config.app_name.trim()) ||
		(typeof clientConfig?.app_name === "string" && (clientConfig.app_name as string).trim()) ||
		(typeof metadata?.app_name === "string" && (metadata.app_name as string).trim()) ||
		(typeof metadata?.brand_name === "string" && (metadata.brand_name as string).trim()) ||
		(typeof metadata?.platform_name === "string" && (metadata.platform_name as string).trim());

	const fromConfigShort =
		(typeof config.short_name === "string" && config.short_name.trim()) ||
		(typeof metadata?.short_name === "string" && (metadata.short_name as string).trim()) ||
		(typeof metadata?.brand_short_name === "string" && (metadata.brand_short_name as string).trim());

	const fromConfigEn =
		(typeof config.en_name === "string" && config.en_name.trim()) ||
		(typeof metadata?.en_name === "string" && (metadata.en_name as string).trim()) ||
		(typeof metadata?.brand_en_name === "string" && (metadata.brand_en_name as string).trim()) ||
		(typeof metadata?.platform_en_name === "string" && (metadata.platform_en_name as string).trim());

	const fromConfigLogo =
		(typeof config.logo_url === "string" && config.logo_url.trim()) ||
		(typeof config.app_logo === "string" && config.app_logo.trim()) ||
		(typeof metadata?.logo_url === "string" && (metadata.logo_url as string).trim()) ||
		(typeof metadata?.app_logo === "string" && (metadata.app_logo as string).trim());

	const fromConfigFavicon =
		(typeof config.favicon_url === "string" && config.favicon_url.trim()) ||
		(typeof config.app_favicon === "string" && config.app_favicon.trim()) ||
		(typeof metadata?.favicon_url === "string" && (metadata.favicon_url as string).trim()) ||
		(typeof metadata?.app_favicon === "string" && (metadata.app_favicon as string).trim());

	const appName = setAppName(fromConfigName || getEnvAppName() || getCachedAppName());
	const shortName = setShortName(fromConfigShort || getEnvShortName() || getCachedShortName() || appName);
	const enName = setEnName(fromConfigEn || getEnvEnName() || getCachedEnName());
	const logoUrl = setAppLogo(fromConfigLogo || getEnvLogo() || getCachedLogo());
	const faviconUrl = setFavicon(fromConfigFavicon || getEnvFavicon() || getCachedFavicon() || logoUrl);

	return { appName, shortName, enName, logoUrl, faviconUrl };
}

export function resolveAppName(config?: Record<string, unknown> | null): string {
	return resolveBranding(config).appName;
}

export function formatBrandText(text: string, appNameOverride?: string): string {
	if (!text) return text;
	const name = appNameOverride || getAppName() || DEFAULT_APP_NAME;
	const en = getEnName() || name.toLowerCase();
	return text
		.replace(/Elygate/g, name)
		.replace(/elygate/g, en.toLowerCase())
		.replace(/Bifrost/g, name)
		.replace(/bifrost/g, en.toLowerCase());
}

// Initial hydration from env / cache
currentAppName = getCachedAppName();
currentShortName = getCachedShortName();
currentEnName = getCachedEnName();
currentLogoUrl = getCachedLogo();
currentFaviconUrl = getCachedFavicon();
if (currentLogoUrl) {
	setAppLogo(currentLogoUrl);
}
if (currentFaviconUrl) {
	setFavicon(currentFaviconUrl);
}
