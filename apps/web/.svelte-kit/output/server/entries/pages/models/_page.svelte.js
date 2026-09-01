import { N as escape_html, a as derived, c as head, d as sanitize_props, f as slot, j as attr, m as stringify, p as spread_props, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Funnel } from "../../../chunks/funnel.js";
import { n as Image, t as Mic } from "../../../chunks/mic.js";
import { t as Layers } from "../../../chunks/layers.js";
import { t as Refresh_cw } from "../../../chunks/refresh-cw.js";
import { t as Search } from "../../../chunks/search.js";
import { t as Zap } from "../../../chunks/zap.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/brain.svelte
function Brain($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "brain" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M12 18V5" }],
				["path", { "d": "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" }],
				["path", { "d": "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" }],
				["path", { "d": "M17.997 5.125a4 4 0 0 1 2.526 5.77" }],
				["path", { "d": "M18 18a4 4 0 0 0 2-7.464" }],
				["path", { "d": "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" }],
				["path", { "d": "M6 18a4 4 0 0 1-2-7.464" }],
				["path", { "d": "M6.003 5.125a4 4 0 0 0-2.526 5.77" }]
			],
			children: ($$renderer) => {
				$$renderer.push(`<!--[-->`);
				slot($$renderer, $$props, "default", {}, null);
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}
	]));
}
//#endregion
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/compass.svelte
function Compass($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "compass" },
		sanitize_props($$props),
		{
			iconNode: [["circle", {
				"cx": "12",
				"cy": "12",
				"r": "10"
			}], ["path", { "d": "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" }]],
			children: ($$renderer) => {
				$$renderer.push(`<!--[-->`);
				slot($$renderer, $$props, "default", {}, null);
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}
	]));
}
//#endregion
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/lightbulb.svelte
function Lightbulb($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "lightbulb" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" }],
				["path", { "d": "M9 18h6" }],
				["path", { "d": "M10 22h4" }]
			],
			children: ($$renderer) => {
				$$renderer.push(`<!--[-->`);
				slot($$renderer, $$props, "default", {}, null);
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}
	]));
}
//#endregion
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/monitor-speaker.svelte
function Monitor_speaker($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "monitor-speaker" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M5.5 20H8" }],
				["path", { "d": "M17 9h.01" }],
				["rect", {
					"width": "10",
					"height": "16",
					"x": "12",
					"y": "4",
					"rx": "2"
				}],
				["path", { "d": "M8 6H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4" }],
				["circle", {
					"cx": "17",
					"cy": "15",
					"r": "1"
				}]
			],
			children: ($$renderer) => {
				$$renderer.push(`<!--[-->`);
				slot($$renderer, $$props, "default", {}, null);
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}
	]));
}
//#endregion
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/sparkles.svelte
function Sparkles($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "sparkles" },
		sanitize_props($$props),
		{
			iconNode: [
				["path", { "d": "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }],
				["path", { "d": "M20 2v4" }],
				["path", { "d": "M22 4h-4" }],
				["circle", {
					"cx": "4",
					"cy": "20",
					"r": "2"
				}]
			],
			children: ($$renderer) => {
				$$renderer.push(`<!--[-->`);
				slot($$renderer, $$props, "default", {}, null);
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}
	]));
}
//#endregion
//#region ../../node_modules/.bun/lucide-svelte@0.575.0+17131baf62b06243/node_modules/lucide-svelte/dist/icons/video.svelte
function Video($$renderer, $$props) {
	Icon($$renderer, spread_props([
		{ name: "video" },
		sanitize_props($$props),
		{
			iconNode: [["path", { "d": "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" }], ["rect", {
				"x": "2",
				"y": "6",
				"width": "14",
				"height": "12",
				"rx": "2"
			}]],
			children: ($$renderer) => {
				$$renderer.push(`<!--[-->`);
				slot($$renderer, $$props, "default", {}, null);
				$$renderer.push(`<!--]-->`);
			},
			$$slots: { default: true }
		}
	]));
}
//#endregion
//#region src/routes/models/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let models = [];
		let isLoading = true;
		let searchQuery = "";
		let isAdmin = derived(() => session.role >= 10);
		let activeProvider = "all";
		let activeCapability = "all";
		let activeStatus = "all";
		const providers = [
			{
				id: "all",
				label: "全部",
				labelEn: "All"
			},
			{
				id: "openai",
				label: "OpenAI",
				labelEn: "OpenAI"
			},
			{
				id: "anthropic",
				label: "Anthropic",
				labelEn: "Anthropic"
			},
			{
				id: "google",
				label: "Google",
				labelEn: "Google"
			},
			{
				id: "deepseek",
				label: "DeepSeek",
				labelEn: "DeepSeek"
			},
			{
				id: "meta",
				label: "Meta (Llama)",
				labelEn: "Meta (Llama)"
			},
			{
				id: "nvidia",
				label: "NVIDIA",
				labelEn: "NVIDIA"
			},
			{
				id: "mistral",
				label: "Mistral",
				labelEn: "Mistral"
			},
			{
				id: "cohere",
				label: "Cohere",
				labelEn: "Cohere"
			},
			{
				id: "alibaba",
				label: "阿里通义",
				labelEn: "Alibaba"
			},
			{
				id: "zhipu",
				label: "智谱清言",
				labelEn: "Zhipu"
			},
			{
				id: "minimax",
				label: "MiniMax",
				labelEn: "MiniMax"
			},
			{
				id: "bytedance",
				label: "字节跳动",
				labelEn: "ByteDance"
			},
			{
				id: "baichuan",
				label: "百川智能",
				labelEn: "Baichuan"
			},
			{
				id: "01ai",
				label: "零一万物",
				labelEn: "01.AI"
			},
			{
				id: "moonshot",
				label: "月之暗面",
				labelEn: "Moonshot"
			},
			{
				id: "others",
				label: "其他",
				labelEn: "Others"
			}
		];
		const capabilities = [
			{
				id: "all",
				label: "全部",
				labelEn: "All",
				icon: Compass
			},
			{
				id: "thinking",
				label: "推理",
				labelEn: "Thinking",
				icon: Lightbulb
			},
			{
				id: "chat",
				label: "对话",
				labelEn: "Chat",
				icon: Brain
			},
			{
				id: "vision",
				label: "视觉",
				labelEn: "Vision",
				icon: Zap
			},
			{
				id: "image",
				label: "绘图",
				labelEn: "Image",
				icon: Image
			},
			{
				id: "video",
				label: "视频",
				labelEn: "Video",
				icon: Video
			},
			{
				id: "audio",
				label: "语音",
				labelEn: "Audio",
				icon: Mic
			},
			{
				id: "embedding",
				label: "向量",
				labelEn: "Embedding",
				icon: Layers
			}
		];
		function getProvider(modelId) {
			const id = modelId.toLowerCase();
			for (const [provider, substrings] of Object.entries({
				openai: [
					"openai",
					"gpt-",
					"o1-",
					"o3-",
					"dall-e"
				],
				anthropic: ["anthropic", "claude-"],
				google: [
					"google",
					"gemini-",
					"palm"
				],
				meta: ["meta", "llama"],
				deepseek: ["deepseek"],
				nvidia: ["nvidia"],
				mistral: ["mistral"],
				cohere: ["cohere", "command-"],
				alibaba: [
					"qwen",
					"alibaba",
					"tongyi"
				],
				zhipu: [
					"glm",
					"zhipu",
					"chatglm"
				],
				minimax: ["minimax", "abab"],
				bytedance: [
					"doubao",
					"bytedance",
					"skylark"
				],
				baichuan: ["baichuan"],
				"01ai": [
					"yi-",
					"01-ai",
					"01ai"
				],
				moonshot: ["moonshot", "kimi"],
				stepfun: ["stepfun", "step-"],
				tencent: ["hunyuan", "tencent"]
			})) for (const sub of substrings) if (id.includes(sub)) return provider;
			return "others";
		}
		function getCapability(modelId, modelType) {
			if (modelType === "video") return "video";
			if (modelType === "image") return "image";
			const id = modelId.toLowerCase();
			if (id.includes("thinking") || id.includes("reasoning") || id.includes("-r1") || id.startsWith("o1-") || id.startsWith("o3-")) return "thinking";
			if (id.includes("text-embedding") || id.includes("-embedding-") || id.includes("bge-") || id.includes("reranker")) return "embedding";
			if (id.includes("dall-e") || id.includes("midjourney") || id.includes("stable-diffusion") || id.includes("flux") || id.includes("kolors")) return "image";
			if (id.includes("tts-") || id.includes("whisper-") || id.includes("audio-") || id.includes("cosyvoice") || id.includes("sensevoice") || id.includes("speechasr") || id.includes("indextts") || id.includes("moss-ttsd")) return "audio";
			if (id.includes("wan2.2") || id.includes("veo3") || id.includes("sora") || id.includes("luma") || id.includes("kling")) return "video";
			if (id.includes("vision") || id.includes("-vl") || id === "gpt-4o" || id === "gpt-4-turbo" || id.startsWith("claude-3-5")) return "vision";
			return "chat";
		}
		let displayLimit = 24;
		let preStatusFilteredModels = derived(() => models.filter((m) => {
			const id = (m.id || "").toLowerCase();
			const name = (m.name || "").toLowerCase();
			const q = searchQuery.toLowerCase();
			const matchesSearch = id.includes(q) || name.includes(q);
			const matchesProvider = activeProvider === "all" || getProvider(id) === activeProvider;
			const matchesCapability = activeCapability === "all" || getCapability(id, m.type) === activeCapability;
			return matchesSearch && matchesProvider && matchesCapability;
		}));
		let counts = derived(() => ({
			all: preStatusFilteredModels().length,
			online: preStatusFilteredModels().filter((m) => (m.status || "online") === "online").length,
			busy: preStatusFilteredModels().filter((m) => m.status === "busy").length,
			offline: preStatusFilteredModels().filter((m) => m.status === "offline").length
		}));
		let filteredModels = derived(() => preStatusFilteredModels().filter((m) => activeStatus === "all" || (m.status || "online") === activeStatus));
		derived(() => filteredModels().slice(0, displayLimit));
		head("18pldtr", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Elygate – ${escape_html(i18n.lang === "zh" ? "模型管理" : "Models")}</title>`);
			});
		});
		$$renderer.push(`<div class="max-w-7xl mx-auto space-y-6"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h1 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">`);
		Monitor_speaker($$renderer, { class: "w-6 h-6 text-indigo-500" });
		$$renderer.push(`<!----> ${escape_html(isAdmin() ? i18n.lang === "zh" ? "模型管理" : "Model Management" : i18n.lang === "zh" ? "可用模型" : "Available Models")}</h1> <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">${escape_html(i18n.lang === "zh" ? "查看系统支持的可用 AI 模型。" : "View available AI models supported by the system.")}</p></div> <div class="flex items-center gap-3"><button${attr("disabled", isLoading, true)} class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all font-medium text-sm shadow-sm disabled:opacity-50">`);
		Refresh_cw($$renderer, { class: `w-4 h-4 ${stringify("animate-spin")}` });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "刷新" : "Refresh")}</button></div></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="space-y-4"><div class="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl flex flex-col lg:flex-row gap-4 justify-between items-center shadow-sm"><div class="relative w-full lg:max-w-md">`);
		Search($$renderer, { class: "absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" });
		$$renderer.push(`<!----> <input type="text"${attr("value", searchQuery)}${attr("placeholder", i18n.t.common.search)} class="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-slate-900 dark:text-white placeholder-slate-400"/></div> <div class="flex flex-wrap items-center gap-2 justify-center lg:justify-end"><div class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg text-xs font-medium text-slate-500">`);
		Funnel($$renderer, { class: "w-3.5 h-3.5" });
		$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "筛选" : "Filters")}</div> <div class="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block"></div> `);
		if (activeProvider !== "all" || activeCapability !== "all" || searchQuery !== "") {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<button class="px-3 py-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors flex items-center gap-1.5">`);
			Refresh_cw($$renderer, { class: "w-3.5 h-3.5" });
			$$renderer.push(`<!----> ${escape_html(i18n.lang === "zh" ? "重置" : "Reset")}</button>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="text-sm text-slate-500 font-medium whitespace-nowrap">${escape_html(i18n.lang === "zh" ? "找到" : "Found")}: <span class="text-indigo-600 dark:text-indigo-400 font-bold">${escape_html(filteredModels().length)}</span></div></div></div> <div class="grid grid-cols-1 md:grid-cols-2 gap-4"><div class="bg-white/40 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 p-3 rounded-2xl"><div class="flex items-center gap-2 mb-3 px-1">`);
		Zap($$renderer, { class: "w-4 h-4 text-amber-500" });
		$$renderer.push(`<!----> <span class="text-xs font-bold uppercase tracking-wider text-slate-400">${escape_html(i18n.lang === "zh" ? "模型厂商" : "Providers")}</span></div> <div class="flex flex-wrap gap-1.5"><!--[-->`);
		const each_array = ensure_array_like(providers);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let p = each_array[$$index];
			$$renderer.push(`<button${attr_class(`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${stringify(activeProvider === p.id ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20 scale-105" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700")}`)}>${escape_html(i18n.lang === "zh" ? p.label : p.labelEn)}</button>`);
		}
		$$renderer.push(`<!--]--></div></div> <div class="bg-white/40 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 p-3 rounded-2xl"><div class="flex items-center gap-2 mb-3 px-1">`);
		Sparkles($$renderer, { class: "w-4 h-4 text-indigo-500" });
		$$renderer.push(`<!----> <span class="text-xs font-bold uppercase tracking-wider text-slate-400">${escape_html(i18n.lang === "zh" ? "核心功能" : "Capabilities")}</span></div> <div class="flex flex-wrap gap-1.5"><!--[-->`);
		const each_array_1 = ensure_array_like(capabilities);
		for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
			let c = each_array_1[$$index_1];
			$$renderer.push(`<button${attr_class(`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${stringify(activeCapability === c.id ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/20 scale-105" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-700")}`)}>`);
			if (c.icon) {
				$$renderer.push("<!--[-->");
				c.icon($$renderer, { class: "w-3.5 h-3.5" });
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
			$$renderer.push(` ${escape_html(i18n.lang === "zh" ? c.label : c.labelEn)}</button>`);
		}
		$$renderer.push(`<!--]--></div></div> <div class="bg-white/40 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 p-3 rounded-2xl md:col-span-2"><div class="flex items-center gap-2 mb-3 px-1">`);
		Monitor_speaker($$renderer, { class: "w-4 h-4 text-emerald-500" });
		$$renderer.push(`<!----> <span class="text-xs font-bold uppercase tracking-wider text-slate-400">${escape_html(i18n.lang === "zh" ? "可用性" : "Availability")}</span></div> <div class="flex flex-wrap gap-1.5"><button${attr_class(`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${stringify(activeStatus === "all" ? "bg-slate-800 text-white shadow-md scale-105" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-slate-300")}`)}>${escape_html(i18n.lang === "zh" ? "全部" : "All")} <span class="ml-1 opacity-60 text-[10px]">(${escape_html(counts().all)})</span></button> <button${attr_class(`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${stringify(activeStatus === "online" ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/20 scale-105" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-emerald-300")}`)}><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> ${escape_html(i18n.lang === "zh" ? "仅在线" : "Online Only")} <span class="ml-1 opacity-80 text-[10px]">(${escape_html(counts().online)})</span></button> <button${attr_class(`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${stringify(activeStatus === "busy" ? "bg-amber-600 text-white shadow-md shadow-amber-500/20 scale-105" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-amber-300")}`)}><span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> ${escape_html(i18n.lang === "zh" ? "繁忙" : "Busy")} <span class="ml-1 opacity-80 text-[10px]">(${escape_html(counts().busy)})</span></button> <button${attr_class(`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${stringify(activeStatus === "offline" ? "bg-rose-600 text-white shadow-md shadow-rose-500/20 scale-105" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-rose-300")}`)}><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ${escape_html(i18n.lang === "zh" ? "已离线" : "Offline")} <span class="ml-1 opacity-80 text-[10px]">(${escape_html(counts().offline)})</span></button></div></div></div></div> <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">`);
		{
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<!--[-->`);
			const each_array_2 = ensure_array_like(Array(8));
			for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
				each_array_2[$$index_2];
				$$renderer.push(`<div class="bg-white/60 dark:bg-slate-900/60 rounded-2xl p-6 border border-slate-200/60 dark:border-slate-800/60 shadow-sm animate-pulse flex flex-col gap-4"><div class="h-6 bg-slate-200 dark:bg-slate-800 rounded w-2/3"></div> <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4"></div> <div class="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between"><div class="h-8 bg-slate-200 dark:bg-slate-800 rounded w-16"></div> <div class="h-8 bg-slate-200 dark:bg-slate-800 rounded w-16"></div></div></div>`);
			}
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></div></div>`);
	});
}
//#endregion
export { _page as default };
