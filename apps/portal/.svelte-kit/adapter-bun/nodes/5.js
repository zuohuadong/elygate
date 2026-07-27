import * as server from '../entries/pages/logs/_page.server.ts.js';

export const index = 5;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/logs/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/logs/+page.server.ts";
export const imports = ["_app/immutable/nodes/5.DPiQSWed.js","_app/immutable/chunks/CHEAdnQw.js","_app/immutable/chunks/xihTtKlq.js","_app/immutable/chunks/C2SnYp1I.js","_app/immutable/chunks/B0MaIu3S.js","_app/immutable/chunks/k8MBd7yK.js"];
export const stylesheets = [];
export const fonts = [];
