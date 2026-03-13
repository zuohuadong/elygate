<script lang="ts">
	import "../app.css";
	import {
		House,
		LayoutDashboard,
		KeyRound,
		Settings,
		Languages,
		Users,
		Gift,
		WalletCards,
		BadgeDollarSign,
		Boxes,
		Cpu,
		ScrollText,
		CreditCard,
		BarChart3,
		History,
		BookOpen,
		Coins,
		Sun,
		Moon,
		Ticket,
		ShoppingBag,
		ShieldAlert,
	} from "lucide-svelte";
	import { page } from "$app/state";
	import { i18n } from "$lib/i18n/index.svelte";
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { session } from "$lib/session.svelte";
	import { apiFetch } from "$lib/api";
	import { theme } from "$lib/theme.svelte";
	import { keyboardShortcuts } from "$lib/keyboard.svelte";
	import { initLogger } from "$lib/logger";

	let { children } = $props();
	let showShortcutsModal = $state(false);
	let isReady = $state(false);
	let publicInfo = $state({
		SEO_Title: "Elygate",
		SEO_Description: "",
		SEO_Keywords: "",
		Logo_URL: "",
		Footer_HTML: "",
		Custom_CSS: "",
		Custom_JS: ""
	});

	// Admin-only routes (regular users should not access these)
	const ADMIN_ROUTES = [
		"/",
		"/channels",
		"/users",
		"/logs",
		"/stats",
		"/redemptions",
		"/invite-codes",
		"/packages",
		"/rate-limits",
		"/settings",
	];
	// Consumer-only routes (admins can still access / which is the dashboard)
	const CONSUMER_ROUTES = [
		"/consumer",
		"/consumer/logs",
		"/consumer/docs",
		"/consumer/packages",
		"/payment",
	];

	onMount(async () => {
		initLogger();
		i18n.init();
		theme.init();

		// Fetch SEO metadata
		apiFetch<{ success: boolean; data: any }>("/info")
			.then((res) => {
				if (res.success) publicInfo = { ...publicInfo, ...res.data };
			})
			.catch(() => {});

		// Check if user is authenticated via Cookie
		try {
			const me = await apiFetch<any>("/user/info");
			if (me && me.username) {
				session.update({
					id: me.id,
					token: me.token || "cookie-session",
					username: me.username,
					role: me.role || 1,
					user: me,
				});

				// If user is already logged in but visiting login/register, redirect them away
				if (isAuthPage) {
					if (session.role >= 10) goto("/");
					else goto("/consumer");
				}
			} else if (!isAuthPage) {
				isReady = true;
				goto("/login");
				return;
			}
		} catch (err) {
			// If we're on a non-auth page and /me fails, we must go to login
			if (!isAuthPage) {
				isReady = true;
				goto("/login");
				return;
			}
		}

		// Register keyboard shortcuts
		keyboardShortcuts.registerMultiple([
			{
				key: "d",
				ctrl: true,
				callback: () => theme.toggle(),
				description: "Toggle dark mode",
			},
			{
				key: "?",
				shift: true,
				callback: () => (showShortcutsModal = !showShortcutsModal),
				description: "Show keyboard shortcuts",
			},
			{
				key: "Escape",
				callback: () => (showShortcutsModal = false),
				description: "Close modal",
			},
		]);

		// Fetch system info for exchange rate
		apiFetch<any>("/status")
			.then((res: any) => {
				if (res.data) {
					session.setSystemInfo({
						exchangeRate: res.data.exchange_rate || 7.2,
						quotaPerUnit: res.data.quota_per_unit || 500000,
					});
				}
			})
			.catch(() => {});

		const path = page.url.pathname;
		const isAdmin = session.role >= 10;

		// Admin goes to dashboard, user goes to consumer page
		if (path === "/") {
			if (!isAdmin) {
				isReady = true;
				goto("/consumer");
				return;
			}
		}

		// Block non-admins from admin-only routes
		if (
			!isAdmin &&
			ADMIN_ROUTES.some((r) => r !== "/" && path.startsWith(r))
		) {
			isReady = true;
			goto("/consumer");
			return;
		}

		// Redirect admins who land on consumer pages to the admin dashboard
		if (isAdmin && CONSUMER_ROUTES.some((r) => path.startsWith(r))) {
			isReady = true;
			goto("/");
			return;
		}

		isReady = true;
	});

	async function toggleCurrency() {
		const newCurrency = session.currency === "USD" ? "RMB" : "USD";
		try {
			await apiFetch("/currency", {
				method: "PUT",
				body: JSON.stringify({ currency: newCurrency }),
			});
			session.updateCurrency(newCurrency);
		} catch (err) {
			console.error("Failed to update currency preference:", err);
			// Still update local state for better UX
			session.updateCurrency(newCurrency);
		}
	}

	function logout() {
		session.clear();
		goto("/login");
	}

	// Side navigation data (Grouped for better UX)
	const navGroups = $derived.by(() => {
		if (session.role >= 10) {
			return [
				{
					title: i18n.t.nav.groups.general,
					items: [
						{
							name: i18n.t.nav.dashboard,
							href: "/",
							icon: LayoutDashboard,
						},
						{
							name: i18n.t.dashboard.title,
							href: "/stats",
							icon: BarChart3,
						},
					]
				},
				{
					title: i18n.t.nav.groups.resources,
					items: [
						{
							name: i18n.lang === "zh" ? "模型管理" : "Models",
							href: "/models",
							icon: Boxes,
						},
						{
							name: i18n.t.nav.channels,
							href: "/channels",
							icon: Cpu,
						},
					]
				},
				{
					title: i18n.t.nav.groups.management,
					items: [
						{
							name: i18n.t.nav.users,
							href: "/users",
							icon: Users,
						},
						{
							name: i18n.lang === "zh" ? "用户组策略" : "User Groups",
							href: "/user-groups",
							icon: Users,
						},
					]
				},
				{
					title: i18n.t.nav.groups.sales,
					items: [
						{
							name: i18n.lang === "zh" ? "套餐方案" : "Packages",
							href: "/packages",
							icon: ShoppingBag,
						},
						{
							name: i18n.lang === "zh" ? "限流规则" : "Rate Limits",
							href: "/rate-limits",
							icon: ShieldAlert,
						},
						{
							name: i18n.t.nav.redemptions || "Redemptions",
							href: "/redemptions",
							icon: Gift,
						},
						{
							name: i18n.lang === "zh" ? "邀请码" : "Invite Codes",
							href: "/invite-codes",
							icon: Ticket,
						},
					]
				},
				{
					title: i18n.t.nav.groups.system,
					items: [
						{
							name: i18n.t.nav.logs,
							href: "/logs",
							icon: ScrollText,
						},
						{
							name: i18n.t.nav.settings,
							href: "/settings",
							icon: Settings,
						},
						{
							name: i18n.t.nav.pricing || "Pricing",
							href: "/pricing",
							icon: BadgeDollarSign,
						},
						{
							name: i18n.t.nav.tokens,
							href: "/tokens",
							icon: KeyRound,
						},
					]
				}
			];
		} else {
			return [
				{
					title: i18n.t.nav.groups.personal,
					items: [
						{
							name: i18n.lang === "zh" ? "我的钱包" : "My Wallet",
							href: "/consumer",
							icon: WalletCards,
						},
						{
							name: i18n.lang === "zh" ? "充值中心" : "Payment",
							href: "/payment",
							icon: CreditCard,
						},
						{
							name: i18n.t.nav.tokens,
							href: "/tokens",
							icon: KeyRound,
						},
						{
							name: i18n.t.nav.pricing || "Pricing",
							href: "/pricing",
							icon: BadgeDollarSign,
						},
					]
				},
				{
					title: i18n.t.nav.groups.docs,
					items: [
						{
							name: i18n.lang === "zh" ? "可用模型" : "Available Models",
							href: "/models",
							icon: Boxes,
						},
						{
							name: i18n.lang === "zh" ? "我的套餐" : "My Plans",
							href: "/consumer/packages",
							icon: ShoppingBag,
						},
						{
							name: i18n.lang === "zh" ? "流水记录" : "Usage Logs",
							href: "/consumer/logs",
							icon: History,
						},
						{
							name: i18n.lang === "zh" ? "在线文档" : "API Docs",
							href: "/consumer/docs",
							icon: BookOpen,
						},
					]
				}
			];
		}
	});

	// Current active path detection
	const isActive = (href: string) => page.url.pathname === href;
	const isAuthPage = $derived(
		page.url.pathname === "/login" || page.url.pathname === "/register",
	);
</script>

<svelte:head>
	<title>{publicInfo.SEO_Title}</title>
	<meta name="description" content={publicInfo.SEO_Description} />
	<meta name="keywords" content={publicInfo.SEO_Keywords} />
	{#if publicInfo.Custom_CSS}
		{@html `<style>${publicInfo.Custom_CSS}</style>`}
	{/if}
	{#if publicInfo.Custom_JS}
		{@html `<script>${publicInfo.Custom_JS}</script>`}
	{/if}
</svelte:head>

{#if isAuthPage}
	{@render children()}
{:else if !isReady}
	<div class="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-950">
		<div class="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div>
	</div>
{:else}
	<div
		class="flex h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden"
	>
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

			<nav class="flex-1 overflow-y-auto py-6 px-4 space-y-6">
				{#each navGroups as group}
					<div class="space-y-1.5">
						<h4 class="px-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
							{group.title}
						</h4>
						<div class="space-y-1">
							{#each group.items as item}
								{@const Icon = item.icon}
								<a
									href={item.href}
									class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
									{isActive(item.href)
										? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm'
										: 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white'}"
								>
									<Icon
										class="w-4 h-4 {isActive(item.href)
											? 'stroke-indigo-600 dark:stroke-indigo-400'
											: 'stroke-slate-500 dark:stroke-slate-400'}"
									/>
									{item.name}
								</a>
							{/each}
						</div>
					</div>
				{/each}
			</nav>

			<!-- Top-up Shortcut for Consumers -->
			{#if session.role < 10}
				<div class="px-4 mb-4">
					<a
						href="/payment"
						class="flex items-center justify-center gap-2 w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
					>
						<CreditCard class="w-4 h-4 text-white" />
						{i18n.lang === "zh" ? "立即充值" : "Top-up Now"}
					</a>
				</div>
			{/if}

			<!-- Sidebar Bottom User Info -->
			<div class="p-4 border-t border-slate-200 dark:border-slate-800">
				<div
					class="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
				>
					<div
						class="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-500 flex items-center justify-center text-white font-medium text-sm shadow-md shrink-0"
					>
						{(session.username || "A").charAt(0).toUpperCase()}
					</div>
					<div class="flex-1 overflow-hidden">
						<p
							class="text-sm font-medium text-slate-900 dark:text-white truncate"
						>
							{session.username || "Admin"}
						</p>
						<p class="text-xs text-slate-500 dark:text-slate-400">
							{session.role >= 10 ? "Super Admin" : "User"}
						</p>
					</div>
					<button
						onclick={logout}
						title="Logout"
						class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path
								d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
							/><polyline points="16 17 21 12 16 7" /><line
								x1="21"
								y1="12"
								x2="9"
								y2="12"
							/>
						</svg>
					</button>
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
						{navGroups.flatMap(g => g.items).find((i) => isActive(i.href))?.name ||
							"Overview"}
					</h1>
				</div>
				<div class="flex items-center gap-4">
					<!-- System Status Badge -->
					<div
						class="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-full"
					>
						<div
							class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"
						></div>
						<span
							class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-tight"
							>{i18n.t.common.systemOnline}</span
						>
					</div>

					<!-- Currency Switcher (only for non-admin users) -->
					{#if session.role < 10}
						<button
							onclick={toggleCurrency}
							class="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors border border-slate-200 dark:border-slate-800"
						>
							<Coins class="w-4 h-4 text-amber-500" />
							{session.currency === "USD" ? "USD / $" : "RMB / ¥"}
						</button>
					{/if}

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
						onclick={() => theme.toggle()}
						class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
						title={theme.value === "dark"
							? "Switch to Light Mode"
							: "Switch to Dark Mode"}
					>
						{#if theme.value === "dark"}
							<Sun class="w-5 h-5" />
						{:else}
							<Moon class="w-5 h-5" />
						{/if}
					</button>
				</div>
			</header>

			<!-- Smooth Content Slot -->
			<div class="flex-1 overflow-y-auto p-8 layout-content">
				{@render children()}
			</div>
		</main>
	</div>
{/if}

<!-- Keyboard Shortcuts Modal -->
{#if showShortcutsModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
		onclick={() => (showShortcutsModal = false)}
		onkeydown={(e) => e.key === "Escape" && (showShortcutsModal = false)}
		role="dialog"
		aria-modal="true"
		aria-label={i18n.lang === "zh" ? "键盘快捷键" : "Keyboard Shortcuts"}
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full mx-4"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between mb-4">
				<h3
					class="text-lg font-semibold text-slate-900 dark:text-white"
				>
					{i18n.lang === "zh" ? "键盘快捷键" : "Keyboard Shortcuts"}
				</h3>
				<button
					onclick={() => (showShortcutsModal = false)}
					class="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
					aria-label={i18n.lang === "zh" ? "关闭" : "Close"}
				>
					<svg
						class="w-5 h-5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
			<div class="space-y-3">
				{#each keyboardShortcuts.getShortcuts() as shortcut}
					<div
						class="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0"
					>
						<span class="text-sm text-slate-600 dark:text-slate-400"
							>{shortcut.description}</span
						>
						<div class="flex items-center gap-1">
							{#if shortcut.ctrl}
								<kbd
									class="px-2 py-1 text-xs font-mono bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
									>⌘</kbd
								>
							{/if}
							{#if shortcut.shift}
								<kbd
									class="px-2 py-1 text-xs font-mono bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
									>⇧</kbd
								>
							{/if}
							<kbd
								class="px-2 py-1 text-xs font-mono bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 uppercase"
								>{shortcut.key}</kbd
							>
						</div>
					</div>
				{/each}
			</div>
			<p
				class="mt-4 text-xs text-slate-500 dark:text-slate-500 text-center"
			>
				{i18n.lang === "zh"
					? "按 ? 显示此帮助"
					: "Press ? to show this help"}
			</p>
		</div>
	</div>
{/if}

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
