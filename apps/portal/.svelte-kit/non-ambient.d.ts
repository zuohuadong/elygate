
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
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/keys" | "/login" | "/logs" | "/logs/export" | "/logs/[id]" | "/members" | "/policy";
		RouteParams(): {
			"/logs/[id]": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string | undefined };
			"/keys": Record<string, never>;
			"/login": Record<string, never>;
			"/logs": { id?: string | undefined };
			"/logs/export": Record<string, never>;
			"/logs/[id]": { id: string };
			"/members": Record<string, never>;
			"/policy": Record<string, never>
		};
		Pathname(): "/" | "/keys" | "/login" | "/logs" | "/logs/export" | `/logs/${string}` & {} | "/members" | "/policy";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/robots.txt" | string & {};
	}
}