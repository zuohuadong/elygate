export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["robots.txt"]),
	mimeTypes: {".txt":"text/plain"},
	_: {
		client: {start:"_app/immutable/entry/start.82-KZ4sW.js",app:"_app/immutable/entry/app.DSXMx6Gj.js",imports:["_app/immutable/entry/start.82-KZ4sW.js","_app/immutable/chunks/CChWvBBq.js","_app/immutable/chunks/BL-5B8Ve.js","_app/immutable/entry/app.DSXMx6Gj.js","_app/immutable/chunks/CChWvBBq.js","_app/immutable/chunks/XXtXHtWx.js","_app/immutable/chunks/ZsEnWiqm.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js'))
		],
		remotes: {
			
		},
		routes: [
			
		],
		prerendered_routes: new Set(["/","/channels","/consumer","/consumer/docs","/consumer/logs","/consumer/packages","/consumer/playground","/consumer/pricing","/invite-codes","/login","/logs","/models","/packages","/payment","/pricing","/rate-limits","/redemptions","/register","/settings","/stats","/status","/tasks","/tokens","/user-groups","/users"]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

export const prerendered = new Set(["/","/channels","/consumer","/consumer/docs","/consumer/logs","/consumer/packages","/consumer/playground","/consumer/pricing","/invite-codes","/login","/logs","/models","/packages","/payment","/pricing","/rate-limits","/redemptions","/register","/settings","/stats","/status","/tasks","/tokens","/user-groups","/users"]);

export const base = "";