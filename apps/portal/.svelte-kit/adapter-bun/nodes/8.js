import * as server from '../entries/pages/policy/_page.server.ts.js';

export const index = 8;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/policy/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/policy/+page.server.ts";
export const imports = ["_app/immutable/nodes/8.C3wR-bUR.js","_app/immutable/chunks/CHEAdnQw.js","_app/immutable/chunks/xihTtKlq.js","_app/immutable/chunks/C2SnYp1I.js","_app/immutable/chunks/CjW30KZV.js","_app/immutable/chunks/BIfyd8C1.js","_app/immutable/chunks/BZzMWY5b.js","_app/immutable/chunks/wKHRLWcu.js","_app/immutable/chunks/B_R9aqYd.js","_app/immutable/chunks/B6r2FaXu.js"];
export const stylesheets = ["_app/immutable/assets/8.Cjl0dsgc.css"];
export const fonts = [];
