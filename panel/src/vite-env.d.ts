/// <reference types="vite/client" />

declare module 'elygate-doc:*' {
	const source: string;
	export default source;
}

interface Window {
	/** Set by the gateway when the dashboard is mounted under server.base_path. */
	__BIFROST_BASE_PATH__?: string;
}
