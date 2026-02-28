<script lang="ts">
	import "../app.css";
	import {
		House,
		LayoutDashboard,
		KeyRound,
		MonitorSpeaker,
		Settings,
		Languages,
	} from "lucide-svelte";
	import { page } from "$app/state";
	import { i18n } from "$lib/i18n";
	import { onMount } from "svelte";

	let { children } = $props();

	onMount(() => i18n.init());

	// Side navigation data (derived from current language)
	const navItems = $derived([
		{ name: i18n.t.nav.dashboard, href: "/", icon: LayoutDashboard },
		{ name: i18n.t.nav.channels, href: "/channels", icon: MonitorSpeaker },
		{ name: i18n.t.nav.tokens, href: "/tokens", icon: KeyRound },
		{ name: i18n.t.nav.logs, href: "/logs", icon: House },
		{ name: i18n.t.nav.settings, href: "/settings", icon: Settings },
	]);

	// Current active path detection
	const isActive = (href: string) => page.url.pathname === href;
</script>

<div class="flex h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
	<!-- Glassmorphism Sidebar -->
	<aside
		class="hidden md:flex flex-col w-64 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-300 z-10"
	>
		<div
			class="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800"
		>
			<div
				class="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-500 shrink-0 shadow-lg shadow-indigo-500/20"
			></div>
			<span
				class="ml-3 font-semibold text-lg tracking-tight text-slate-900 dark:text-white"
				>Elygate</span
			>
		</div>

		<nav class="flex-1 overflow-y-auto py-6 px-4 space-y-1.5">
			{#each navItems as item}
				{@const Icon = item.icon}
				<a
					href={item.href}
					class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
					{isActive(item.href)
						? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm'
						: 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white'}"
				>
					<Icon
						class="w-5 h-5 {isActive(item.href)
							? 'stroke-indigo-600 dark:stroke-indigo-400'
							: 'stroke-slate-500 dark:stroke-slate-400'}"
					/>
					{item.name}
				</a>
			{/each}
		</nav>

		<!-- Sidebar Bottom User Info -->
		<div class="p-4 border-t border-slate-200 dark:border-slate-800">
			<div
				class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
			>
				<div
					class="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-500 flex items-center justify-center text-white font-medium text-sm shadow-md"
				>
					A
				</div>
				<div class="flex-1 overflow-hidden">
					<p
						class="text-sm font-medium text-slate-900 dark:text-white truncate"
					>
						Admin
					</p>
					<p
						class="text-xs text-slate-500 dark:text-slate-400 truncate"
					>
						admin@elygate.io
					</p>
				</div>
			</div>
		</div>
	</aside>

	<!-- Main Exhibit Area -->
	<main
		class="flex-1 flex flex-col min-w-0 bg-slate-50/50 dark:bg-slate-950/50 relative"
	>
		<!-- Top Bar -->
		<header
			class="h-16 flex-shrink-0 flex items-center justify-between px-8 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 sticky top-0 z-20"
		>
			<div class="flex items-center">
				<h1
					class="text-lg font-medium text-slate-800 dark:text-slate-100"
				>
					{navItems.find((i) => isActive(i.href))?.name || "Overview"}
				</h1>
			</div>
			<div class="flex items-center gap-4">
				<!-- Language Switcher -->
				<button
					onclick={() =>
						i18n.setLang(i18n.lang === "zh" ? "en" : "zh")}
					class="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors border border-slate-200 dark:border-slate-800"
				>
					<Languages class="w-4 h-4" />
					{i18n.lang === "zh" ? "English" : "简体中文"}
				</button>

				<button
					class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
				>
					<MonitorSpeaker class="w-5 h-5" />
				</button>
			</div>
		</header>

		<!-- Smooth Content Slot -->
		<div class="flex-1 overflow-y-auto p-8 layout-content">
			{@render children()}
		</div>
	</main>
</div>

<style>
	:global(body) {
		transition:
			background-color 0.3s ease,
			color 0.3s ease;
	}
	.layout-content {
		animation: fade-in-up 0.4s ease-out;
	}
	@keyframes fade-in-up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
