<script lang="ts">
	import { onMount } from "svelte";
	import { i18n } from "$lib/i18n/index.svelte";
	import { apiFetch } from "$lib/api";
	import {
		TrendingUp,
		TrendingDown,
		Users,
		Activity,
		DollarSign,
		Zap,
		Clock,
		BarChart3,
		AlertCircle
	} from "lucide-svelte";

	let overview = $state<any>({});
	let todayStats = $state<any>({});
	let hourlyStats = $state<any[]>([]);
	let modelStats = $state<any[]>([]);
	let realtimeStats = $state<any>({});
	let loading = $state(true);
	let error = $state<string | null>(null);
	let autoRefresh = $state(true);
	let refreshInterval: any = null;

	onMount(() => {
		loadAllStats();

		if (autoRefresh) {
			refreshInterval = setInterval(loadRealtimeStats, 60000);
		}

		return () => {
			if (refreshInterval) {
				clearInterval(refreshInterval);
			}
		};
	});

	async function loadAllStats() {
		try {
			loading = true;
			error = null;
			await Promise.all([
				loadOverview(),
				loadModelStats(),
				loadRealtimeStats(),
			]);
		} catch (err: any) {
			console.error("Failed to load stats:", err);
			error = err.message || "Failed to load statistics";
		} finally {
			loading = false;
		}
	}

	async function loadOverview() {
		try {
			const data = await apiFetch<any>("/stats/overview");
			overview = data?.overview || {};
			todayStats = data?.today || {};
			hourlyStats = data?.hourly || [];
		} catch (err: any) {
			console.error("Failed to load overview:", err);
			// Set default values on error
			overview = {};
			todayStats = {};
			hourlyStats = [];
		}
	}

	async function loadModelStats() {
		try {
			const data = await apiFetch<any>("/stats/models");
			modelStats = data?.trending || [];
		} catch (err: any) {
			console.error("Failed to load model stats:", err);
			modelStats = [];
		}
	}

	async function loadRealtimeStats() {
		try {
			const data = await apiFetch<any>("/stats/realtime");
			realtimeStats = data?.stats || {};
		} catch (err: any) {
			console.error("Failed to load realtime stats:", err);
			realtimeStats = {};
		}
	}

	function formatNumber(num: number): string {
		if (!num || num === 0) return "0";
		if (num >= 1000000) {
			return `${(num / 1000000).toFixed(1)}M`;
		} else if (num >= 1000) {
			return `${(num / 1000).toFixed(1)}K`;
		}
		return num.toString();
	}

	function formatCurrency(amount: number): string {
		if (!amount || amount === 0) return "$0.00";
		return `$${(amount / 1000).toFixed(2)}`;
	}

	function getHourLabel(hour: number): string {
		return `${hour.toString().padStart(2, "0")}:00`;
	}

	function hasData(): boolean {
		return (
			Object.keys(overview).length > 0 ||
			Object.keys(todayStats).length > 0 ||
			hourlyStats.length > 0 ||
			modelStats.length > 0
		);
	}
</script>

<div class="container mx-auto p-6">
	<!-- Header -->
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold text-gray-900 dark:text-white">
				{i18n.lang === "zh" ? "数据统计" : "Statistics Dashboard"}
			</h1>
			<p class="text-gray-600 dark:text-gray-400 mt-2">
				{i18n.lang === "zh"
					? "实时监控系统运行状态"
					: "Real-time monitoring of system status"}
			</p>
		</div>
		<div class="flex items-center gap-4">
			<label
				class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
			>
				<input
					type="checkbox"
					bind:checked={autoRefresh}
					class="rounded"
				/>
				{i18n.lang === "zh" ? "自动刷新" : "Auto Refresh"}
			</label>
			<button
				onclick={loadAllStats}
				disabled={loading}
				class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
			>
				{loading
					? i18n.lang === "zh"
						? "刷新中..."
						: "Refreshing..."
					: i18n.lang === "zh"
						? "刷新数据"
						: "Refresh"}
			</button>
		</div>
	</div>

	<!-- Loading State -->
	{#if loading}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
				<p class="text-gray-600 dark:text-gray-400">
					{i18n.lang === "zh" ? "加载中..." : "Loading..."}
				</p>
			</div>
		</div>
	{:else if error}
		<!-- Error State -->
		<div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 mb-8">
			<div class="flex items-center gap-3">
				<AlertCircle class="w-6 h-6 text-red-600 dark:text-red-400" />
				<div>
					<h3 class="font-semibold text-red-800 dark:text-red-200">
						{i18n.lang === "zh" ? "加载失败" : "Failed to Load"}
					</h3>
					<p class="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
				</div>
			</div>
		</div>
	{:else if !hasData()}
		<!-- Empty State -->
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-12 text-center">
			<BarChart3 class="w-16 h-16 text-gray-400 mx-auto mb-4" />
			<h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
				{i18n.lang === "zh" ? "暂无统计数据" : "No Statistics Data"}
			</h3>
			<p class="text-gray-600 dark:text-gray-400 mb-6">
				{i18n.lang === "zh"
					? "系统运行后将自动生成统计数据，请稍后再查看"
					: "Statistics will be generated automatically after the system runs. Please check again later."}
			</p>
			<button
				onclick={loadAllStats}
				class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
			>
				{i18n.lang === "zh" ? "刷新数据" : "Refresh Data"}
			</button>
		</div>
	{:else}

	<!-- Overview Cards -->
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
		<!-- Total Users -->
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "总用户数" : "Total Users"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatNumber(overview.total_users || 0)}
					</p>
				</div>
				<div
					class="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center"
				>
					<Users class="w-6 h-6 text-blue-600 dark:text-blue-400" />
				</div>
			</div>
		</div>

		<!-- Active Tokens -->
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "活跃令牌" : "Active Tokens"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatNumber(overview.active_tokens || 0)}
					</p>
				</div>
				<div
					class="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center"
				>
					<Zap class="w-6 h-6 text-green-600 dark:text-green-400" />
				</div>
			</div>
		</div>

		<!-- Requests (24h) -->
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "24小时请求" : "Requests (24h)"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatNumber(overview.requests_24h || 0)}
					</p>
				</div>
				<div
					class="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center"
				>
					<Activity
						class="w-6 h-6 text-purple-600 dark:text-purple-400"
					/>
				</div>
			</div>
		</div>

		<!-- Cost (24h) -->
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "24小时费用" : "Cost (24h)"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatCurrency(overview.cost_24h || 0)}
					</p>
				</div>
				<div
					class="w-12 h-12 bg-yellow-100 dark:bg-yellow-900 rounded-lg flex items-center justify-center"
				>
					<DollarSign
						class="w-6 h-6 text-yellow-600 dark:text-yellow-400"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Real-time Stats -->
	<div class="bg-white dark:bg-gray-800 rounded-lg shadow mb-8">
		<div class="p-6 border-b border-gray-200 dark:border-gray-700">
			<h2
				class="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2"
			>
				<Clock class="w-5 h-5" />
				{i18n.lang === "zh" ? "实时监控" : "Real-time Monitoring"}
			</h2>
		</div>
		<div class="p-6">
			<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
				<div class="text-center">
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "每分钟请求" : "Requests/min"}
					</p>
					<p
						class="text-3xl font-bold text-gray-900 dark:text-white mt-2"
					>
						{realtimeStats.requests_per_minute || 0}
					</p>
				</div>
				<div class="text-center">
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "活跃用户" : "Active Users"}
					</p>
					<p
						class="text-3xl font-bold text-gray-900 dark:text-white mt-2"
					>
						{realtimeStats.active_users || 0}
					</p>
				</div>
				<div class="text-center">
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "活跃模型" : "Active Models"}
					</p>
					<p
						class="text-3xl font-bold text-gray-900 dark:text-white mt-2"
					>
						{realtimeStats.active_models || 0}
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Charts Row -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
		<!-- Hourly Chart -->
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow">
			<div class="p-6 border-b border-gray-200 dark:border-gray-700">
				<h2
					class="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2"
				>
					<BarChart3 class="w-5 h-5" />
					{i18n.lang === "zh"
						? "24小时请求趋势"
						: "24h Request Trend"}
				</h2>
			</div>
			<div class="p-6">
				{#if hourlyStats.length > 0}
					<div class="h-64 flex items-end gap-1">
						{#each hourlyStats as stat}
							{@const height = Math.max(
								10,
								(stat.request_count /
									Math.max(
										...hourlyStats.map(
											(s) => s.request_count,
										),
									)) *
									200,
							)}
							<div
								class="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition cursor-pointer relative group"
								style="height: {height}px"
							>
								<div
									class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap"
								>
									{getHourLabel(stat.hour)}: {stat.request_count}
									{i18n.lang === "zh" ? "请求" : "requests"}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="h-64 flex items-center justify-center text-gray-500 dark:text-gray-400"
					>
						{i18n.lang === "zh" ? "暂无数据" : "No data available"}
					</div>
				{/if}
			</div>
		</div>

		<!-- Top Models -->
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow">
			<div class="p-6 border-b border-gray-200 dark:border-gray-700">
				<h2
					class="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2"
				>
					<TrendingUp class="w-5 h-5" />
					{i18n.lang === "zh" ? "热门模型" : "Trending Models"}
				</h2>
			</div>
			<div class="p-6">
				{#if modelStats.length > 0}
					<div class="space-y-4">
						{#each modelStats.slice(0, 5) as model, i}
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<span
										class="text-sm font-medium text-gray-500 dark:text-gray-400"
									>
										#{i + 1}
									</span>
									<span
										class="font-medium text-gray-900 dark:text-white"
									>
										{model.model_name}
									</span>
								</div>
								<div class="text-right">
									<p
										class="text-sm font-semibold text-gray-900 dark:text-white"
									>
										{formatNumber(model.request_count)}
										{i18n.lang === "zh"
											? "请求"
											: "requests"}
									</p>
									<p
										class="text-xs text-gray-500 dark:text-gray-400"
									>
										{formatCurrency(model.total_cost)}
									</p>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="h-64 flex items-center justify-center text-gray-500 dark:text-gray-400"
					>
						{i18n.lang === "zh" ? "暂无数据" : "No data available"}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Today's Summary -->
	<div class="bg-white dark:bg-gray-800 rounded-lg shadow">
		<div class="p-6 border-b border-gray-200 dark:border-gray-700">
			<h2 class="text-xl font-semibold text-gray-900 dark:text-white">
				{i18n.lang === "zh" ? "今日统计" : "Today's Summary"}
			</h2>
		</div>
		<div class="p-6">
			<div class="grid grid-cols-2 md:grid-cols-4 gap-6">
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "请求数" : "Requests"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatNumber(todayStats.request_count || 0)}
					</p>
				</div>
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "Token 使用" : "Tokens Used"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatNumber(todayStats.total_tokens || 0)}
					</p>
				</div>
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "总费用" : "Total Cost"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatCurrency(todayStats.total_cost || 0)}
					</p>
				</div>
				<div>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{i18n.lang === "zh" ? "流式请求" : "Stream Requests"}
					</p>
					<p
						class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
					>
						{formatNumber(todayStats.stream_count || 0)}
					</p>
				</div>
			</div>
		</div>
	</div>
	{/if}
</div>
