import * as server from '../entries/pages/logs/_id_/_page.server.ts.js';

export const index = 6;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/logs/_id_/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/logs/[id]/+page.server.ts";
export const imports = ["_app/immutable/nodes/6.CB2li1L0.js","_app/immutable/chunks/CHEAdnQw.js","_app/immutable/chunks/xihTtKlq.js","_app/immutable/chunks/C2SnYp1I.js","_app/immutable/chunks/B0MaIu3S.js","_app/immutable/chunks/CjW30KZV.js"];
export const stylesheets = [];
export const fonts = [];
