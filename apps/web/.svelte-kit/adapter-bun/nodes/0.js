

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const universal = {
  "prerender": true,
  "ssr": false
};
export const universal_id = "src/routes/+layout.ts";
export const imports = ["_app/immutable/nodes/0.C1r9RDPx.js","_app/immutable/chunks/CChWvBBq.js","_app/immutable/chunks/BL-5B8Ve.js","_app/immutable/chunks/BqQ2Kijl.js","_app/immutable/chunks/wh1JdaC5.js","_app/immutable/chunks/DpPoWQyU.js","_app/immutable/chunks/BJJsbmf-.js","_app/immutable/chunks/BB6daT7o.js","_app/immutable/chunks/D_TP4ntj.js","_app/immutable/chunks/CMUFXc7k.js","_app/immutable/chunks/BiJ5MCud.js","_app/immutable/chunks/wc6RYuzE.js","_app/immutable/chunks/BFpIGy-G.js","_app/immutable/chunks/BrSV9oOR.js","_app/immutable/chunks/Bw0ktJl2.js","_app/immutable/chunks/B69y7r8n.js","_app/immutable/chunks/C_Ljsz9H.js","_app/immutable/chunks/DNXOB3aC.js","_app/immutable/chunks/CCdub7EY.js","_app/immutable/chunks/hHmmdcOO.js","_app/immutable/chunks/Dp6RidKV.js","_app/immutable/chunks/B9Mah55v.js","_app/immutable/chunks/fiUfht4z.js","_app/immutable/chunks/ZsEnWiqm.js","_app/immutable/chunks/ryc473S_.js"];
export const stylesheets = ["_app/immutable/assets/0.BUruPcMH.css"];
export const fonts = [];
