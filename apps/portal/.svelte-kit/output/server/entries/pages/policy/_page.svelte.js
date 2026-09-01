import { _ as escape_html, c as ensure_array_like, d as spread_props, h as attr, r as attr_class } from "../../../chunks/index-server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Cpu } from "../../../chunks/cpu.js";
import { t as Shield_check } from "../../../chunks/shield-check.js";
import "../../../chunks/forms.js";
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/bell.svelte
function Bell($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "bell" },
		props,
		{ iconNode: [["path", { "d": "M10.268 21a2 2 0 0 0 3.464 0" }], ["path", { "d": "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" }]] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/globe.svelte
function Globe($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "globe" },
		props,
		{ iconNode: [
			["circle", {
				"cx": "12",
				"cy": "12",
				"r": "10"
			}],
			["path", { "d": "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
			["path", { "d": "M2 12h20" }]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/save.svelte
function Save($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "save" },
		props,
		{ iconNode: [
			["path", { "d": "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }],
			["path", { "d": "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }],
			["path", { "d": "M7 3v4a1 1 0 0 0 1 1h7" }]
		] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/circle-check.svelte
function Circle_check($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "circle-check" },
		props,
		{ iconNode: [["circle", {
			"cx": "12",
			"cy": "12",
			"r": "10"
		}], ["path", { "d": "m9 12 2 2 4-4" }]] }
	]));
}
//#endregion
//#region ../../node_modules/.bun/@lucide+svelte@1.22.0+ff5f301bb2db9a0d/node_modules/@lucide/svelte/dist/icons/triangle-alert.svelte
function Triangle_alert($$renderer, $$props) {
	let { $$slots, $$events, ...props } = $$props;
	Icon($$renderer, spread_props([
		{ name: "triangle-alert" },
		props,
		{ iconNode: [
			["path", { "d": "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
			["path", { "d": "M12 9v4" }],
			["path", { "d": "M12 17h.01" }]
		] }
	]));
}
//#endregion
//#region src/routes/policy/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		let policy = {
			allowedModels: [],
			deniedModels: [],
			allowedSubnets: "",
			alertThresholdPct: 80,
			alertWebhookUrl: ""
		};
		let saving = false;
		$$renderer.push(`<div class="max-w-4xl space-y-8"><form method="POST" action="?/updatePolicy" class="space-y-8"><div class="flex items-center justify-between sticky top-0 z-10 py-4 bg-[#0d1117]/80 backdrop-blur-md"><h2 class="text-xl font-bold text-white flex items-center gap-2">`);
		Shield_check($$renderer, { class: "text-blue-500" });
		$$renderer.push(`<!----> Organization Policies</h2> <div class="flex items-center gap-4">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <button type="submit"${attr("disabled", saving, true)} class="btn-primary flex items-center gap-2">`);
		Save($$renderer, { size: 18 });
		$$renderer.push(`<!----> ${escape_html("Save Changes")}</button></div></div> <input type="hidden" name="allowedModels"${attr("value", JSON.stringify(policy.allowedModels))}/> <input type="hidden" name="deniedModels"${attr("value", JSON.stringify(policy.deniedModels))}/> <input type="hidden" name="alertThresholdPct"${attr("value", policy.alertThresholdPct)}/> <div class="glass-card p-8 space-y-6"><div class="flex items-center gap-3 border-b border-[#30363d] pb-4">`);
		Globe($$renderer, {
			class: "text-gray-400",
			size: 20
		});
		$$renderer.push(`<!----> <div><h3 class="text-lg font-semibold text-white">Network Security</h3> <p class="text-xs text-gray-500">Restricts API access to specific IP ranges for all users in this org.</p></div></div> <div class="space-y-4"><label class="block"><span class="text-sm font-medium text-gray-300">Allowed IP Ranges (CIDR)</span> <textarea name="allowedSubnets" placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8" class="mt-2 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-sm font-mono focus:border-blue-500 outline-none transition-all h-24">`);
		const $$body = escape_html(policy.allowedSubnets);
		if ($$body) $$renderer.push(`${$$body}`);
		$$renderer.push(`</textarea> <span class="text-[10px] text-gray-600">Leave blank to allow all IPs. Separate multiple ranges with commas or newlines.</span></label></div></div> <div class="glass-card p-8 space-y-6"><div class="flex items-center gap-3 border-b border-[#30363d] pb-4">`);
		Cpu($$renderer, {
			class: "text-gray-400",
			size: 20
		});
		$$renderer.push(`<!----> <div><h3 class="text-lg font-semibold text-white">Model Restrictions</h3> <p class="text-xs text-gray-500">Control which models your team members can use.</p></div></div> <div class="grid grid-cols-1 md:grid-cols-2 gap-8"><div class="space-y-4"><h4 class="text-sm font-medium text-red-400 flex items-center gap-2">`);
		Triangle_alert($$renderer, { size: 14 });
		$$renderer.push(`<!----> Denied Models (Blacklist)</h4> <div class="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar svelte-rhu1d7"><!--[-->`);
		const each_array = ensure_array_like(data.availableModels);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let m = each_array[$$index];
			$$renderer.push(`<label${attr_class(`flex items-center justify-between px-3 py-2 bg-red-500/5 border ${policy.deniedModels.includes(m) ? "border-red-500/50 bg-red-500/10" : "border-white/5"} rounded-md text-xs cursor-pointer hover:bg-red-500/10 transition-all`)}><span class="text-gray-300">${escape_html(m)}</span> <input type="checkbox"${attr("checked", policy.deniedModels.includes(m), true)} class="accent-red-500"/></label>`);
		}
		$$renderer.push(`<!--]--></div></div> <div class="space-y-4"><h4 class="text-sm font-medium text-green-400 flex items-center gap-2">`);
		Circle_check($$renderer, { size: 14 });
		$$renderer.push(`<!----> Explicitly Allowed (Whitelist)</h4> <div class="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar svelte-rhu1d7"><!--[-->`);
		const each_array_1 = ensure_array_like(data.availableModels);
		for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
			let m = each_array_1[$$index_1];
			$$renderer.push(`<label${attr_class(`flex items-center justify-between px-3 py-2 bg-green-500/5 border ${policy.allowedModels.includes(m) ? "border-green-500/50 bg-green-500/10" : "border-white/5"} rounded-md text-xs cursor-pointer hover:bg-green-500/10 transition-all`)}><span class="text-gray-300">${escape_html(m)}</span> <input type="checkbox"${attr("checked", policy.allowedModels.includes(m), true)} class="accent-green-500"/></label>`);
		}
		$$renderer.push(`<!--]--></div></div></div> <p class="text-[10px] text-gray-500 italic">Note: Blacklist is checked first. If a model is in both lists, it will be BLOCKED. Whitelist only takes effect if not empty.</p></div> <div class="glass-card p-8 space-y-6"><div class="flex items-center gap-3 border-b border-[#30363d] pb-4">`);
		Bell($$renderer, {
			class: "text-gray-400",
			size: 20
		});
		$$renderer.push(`<!----> <div><h3 class="text-lg font-semibold text-white">Usage Alerts</h3> <p class="text-xs text-gray-500">Get notified when organization quota reaches a threshold.</p></div></div> <div class="space-y-6"><div class="flex items-center gap-8"><div class="flex-1"><div class="flex justify-between mb-2"><span class="text-sm text-gray-400">Alarm Threshold</span> <span class="text-sm font-bold text-blue-500">${escape_html(policy.alertThresholdPct)}%</span></div> <input type="range" min="10" max="100" step="5"${attr("value", policy.alertThresholdPct)} class="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"/></div> <div class="w-32 text-[10px] text-gray-500">Current usage at <span class="text-white">${escape_html((data.org.usedQuota / Math.max(data.org.totalQuota, 1) * 100).toFixed(1))}%</span></div></div> <div class="space-y-2"><label class="block"><span class="text-sm font-medium text-gray-300">Webhook URL (Slack/Web)</span> <input type="url" name="alertWebhookUrl"${attr("value", policy.alertWebhookUrl)} placeholder="https://hooks.slack.com/services/..." class="mt-2 w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5 text-xs focus:border-blue-500 outline-none transition-all"/></label> <span class="text-[10px] text-gray-600">POST request will be sent to this URL when threshold is hit.</span></div></div></div></form></div>`);
	});
}
//#endregion
export { _page as default };
