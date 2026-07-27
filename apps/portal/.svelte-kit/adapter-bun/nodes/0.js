import * as server from '../entries/pages/_layout.server.ts.js';

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export { server };
export const server_id = "src/routes/+layout.server.ts";
export const imports = ["_app/immutable/nodes/0.Bk5oLqLq.js","_app/immutable/chunks/CHEAdnQw.js","_app/immutable/chunks/xihTtKlq.js","_app/immutable/chunks/0w0SVLxK.js","_app/immutable/chunks/B_R9aqYd.js","_app/immutable/chunks/C2SnYp1I.js","_app/immutable/chunks/D0SY_wi4.js","_app/immutable/chunks/BIfyd8C1.js"];
export const stylesheets = ["_app/immutable/assets/0.DgmH9fRH.css"];
export const fonts = [];
