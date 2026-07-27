
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/channels" | "/consumer" | "/consumer/docs" | "/consumer/logs" | "/consumer/packages" | "/consumer/playground" | "/consumer/pricing" | "/invite-codes" | "/login" | "/logs" | "/models" | "/packages" | "/payment" | "/pricing" | "/rate-limits" | "/redemptions" | "/register" | "/settings" | "/stats" | "/status" | "/tasks" | "/tokens" | "/user-groups" | "/users";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/": Record<string, never>;
			"/channels": Record<string, never>;
			"/consumer": Record<string, never>;
			"/consumer/docs": Record<string, never>;
			"/consumer/logs": Record<string, never>;
			"/consumer/packages": Record<string, never>;
			"/consumer/playground": Record<string, never>;
			"/consumer/pricing": Record<string, never>;
			"/invite-codes": Record<string, never>;
			"/login": Record<string, never>;
			"/logs": Record<string, never>;
			"/models": Record<string, never>;
			"/packages": Record<string, never>;
			"/payment": Record<string, never>;
			"/pricing": Record<string, never>;
			"/rate-limits": Record<string, never>;
			"/redemptions": Record<string, never>;
			"/register": Record<string, never>;
			"/settings": Record<string, never>;
			"/stats": Record<string, never>;
			"/status": Record<string, never>;
			"/tasks": Record<string, never>;
			"/tokens": Record<string, never>;
			"/user-groups": Record<string, never>;
			"/users": Record<string, never>
		};
		Pathname(): "/" | "/channels" | "/consumer" | "/consumer/docs" | "/consumer/logs" | "/consumer/packages" | "/consumer/playground" | "/consumer/pricing" | "/invite-codes" | "/login" | "/logs" | "/models" | "/packages" | "/payment" | "/pricing" | "/rate-limits" | "/redemptions" | "/register" | "/settings" | "/stats" | "/status" | "/tasks" | "/tokens" | "/user-groups" | "/users";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/robots.txt" | string & {};
	}
}