import * as server from '../entries/pages/_page.server.ts.js';

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/+page.server.ts";
export const imports = ["_app/immutable/nodes/2.VIGyoVh0.js","_app/immutable/chunks/CHEAdnQw.js","_app/immutable/chunks/xihTtKlq.js","_app/immutable/chunks/C2SnYp1I.js","_app/immutable/chunks/D0SY_wi4.js"];
export const stylesheets = [];
export const fonts = [];
