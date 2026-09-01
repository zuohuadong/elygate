//#region src/lib/api.ts
var API_BASE = "/api";
/**
* Universal fetch with auth headers and JSON support
*/
async function apiFetch(endpoint, options = {}) {
	const headers = {
		"Content-Type": "application/json",
		...options.headers || {}
	};
	const baseUrl = endpoint.startsWith("/v1") ? "" : API_BASE;
	const response = await fetch(`${baseUrl}${endpoint}`, {
		...options,
		headers,
		credentials: "include"
	});
	if (!response.ok) {
		let errorMsg = response.statusText;
		try {
			const clonedResponse = response.clone();
			try {
				const errData = await clonedResponse.json();
				if (errData && errData.message) errorMsg = errData.message;
				else if (typeof errData === "string") errorMsg = errData;
			} catch {
				const text = await response.text();
				if (text) errorMsg = text;
			}
		} catch {}
		throw new Error(errorMsg || `Error ${response.status}`);
	}
	return response.json();
}
//#endregion
export { apiFetch as t };
