<script lang="ts">
	import { onMount } from "svelte";
	import { i18n } from "$lib/i18n/index.svelte";
	import { apiFetch } from "$lib/api";
	import { session } from "$lib/session.svelte";
	import { CreditCard, Clock, CheckCircle2, XCircle } from "lucide-svelte";

	let balance = $state(0);
	let orders = $state<any[]>([]);
	let loading = $state(false);
	let showPaymentModal = $state(false);
	let selectedAmount = $state(1000);
	let selectedMethod = $state("stripe");
	let isBackdropMouseDown = false;

	// System settings
	let paymentEnabled = $state(true);
	let paymentMethods = $state<string[]>([]);

	const amounts = [
		{ value: 1000, label: "$10.00" },
		{ value: 5000, label: "$50.00" },
		{ value: 10000, label: "$100.00" },
		{ value: 50000, label: "$500.00" },
		{ value: 100000, label: "$1000.00" },
	];

	onMount(async () => {
		await loadSettings();
		await loadBalance();
		await loadOrders();
	});

	async function loadSettings() {
		try {
			const res = await apiFetch<any>("/api/option");
			if (res && res.data) {
				paymentEnabled = res.data.PaymentEnabled;
				paymentMethods = (res.data.PaymentMethods || "").split(",");
				if (paymentMethods.length > 0 && !paymentMethods.includes(selectedMethod)) {
					selectedMethod = paymentMethods[0];
				}
			}
		} catch (error) {
			console.error("Failed to load payment settings:", error);
		}
	}

	async function loadBalance() {
		try {
			const data = await apiFetch<any>("/me");
			balance = data.quota || 0;
		} catch (error) {
			console.error("Failed to load balance:", error);
		}
	}

	async function loadOrders() {
		try {
			loading = true;
			const data = await apiFetch<any[]>("/payment/orders");
			orders = data || [];
		} catch (error) {
			console.error("Failed to load orders:", error);
		} finally {
			loading = false;
		}
	}

	async function createPayment() {
		try {
			loading = true;
			const data = await apiFetch<any>("/payment/create-order", {
				method: "POST",
				body: JSON.stringify({
					amount: selectedAmount,
					paymentMethod: selectedMethod,
				}),
			});

			if (data.success && data.paymentUrl) {
				window.location.href = data.paymentUrl;
			}
		} catch (error: any) {
			console.error("Failed to create payment:", error);
			alert(error.message || i18n.t.payment.createFailed);
		} finally {
			loading = false;
			showPaymentModal = false;
		}
	}

	function formatAmount(amount: number): string {
		return `${session.currency === "RMB" ? "¥" : "$"}${(
			(amount / session.quotaPerUnit) *
			(session.currency === "RMB" ? session.exchangeRate : 1)
		).toFixed(2)}`;
	}

	function formatDate(date: string): string {
		return new Date(date).toLocaleString();
	}

	function getStatusText(status: number): string {
		switch (status) {
			case 0:
				return i18n.lang === "zh" ? "待支付" : "Pending";
			case 1:
				return i18n.lang === "zh" ? "已完成" : "Completed";
			case 2:
				return i18n.lang === "zh" ? "已失败" : "Failed";
			default:
				return i18n.lang === "zh" ? "未知" : "Unknown";
		}
	}

	function getStatusIcon(status: number) {
		switch (status) {
			case 0:
				return Clock;
			case 1:
				return CheckCircle2;
			case 2:
				return XCircle;
			default:
				return Clock;
		}
	}

	function handleMouseDown(e: MouseEvent) {
		isBackdropMouseDown = e.target === e.currentTarget;
	}

	function handleBackdropClick() {
		if (isBackdropMouseDown) {
			showPaymentModal = false;
		}
	}
</script>

<div class="container mx-auto p-6">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-3xl font-bold text-gray-900 dark:text-white">
			{i18n.lang === "zh" ? "充值中心" : "Payment Center"}
		</h1>
		<p class="text-gray-600 dark:text-gray-400 mt-2">
			{i18n.lang === "zh"
				? "管理您的账户余额和支付订单"
				: "Manage your account balance and payment orders"}
		</p>
	</div>

	<!-- Balance Card -->
	<div
		class="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-8 text-white shadow-lg mb-8"
	>
		<div class="flex items-center justify-between">
			<div class="flex-1">
				<h1 class="text-3xl font-bold mb-2">
					{i18n.t.payment.balance}
				</h1>
				<p class="text-blue-100 text-lg opacity-90">
					{formatAmount(balance)}
				</p>
			</div>
			{#if paymentEnabled}
				<button
					onclick={() => (showPaymentModal = true)}
					class="bg-white text-blue-600 px-6 py-3 rounded-lg font-semibold hover:bg-opacity-90 transition flex items-center gap-2"
				>
					<CreditCard class="w-5 h-5" />
					{i18n.t.payment.topup}
				</button>
			{/if}
		</div>
	</div>

	<!-- Payment Methods / Disabled Notice -->
	{#if paymentEnabled}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
			{#if paymentMethods.includes("stripe")}
				<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
					<div class="flex items-center gap-3 mb-4">
						<div
							class="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center"
						>
							<span class="text-2xl">💳</span>
						</div>
						<div>
							<h3 class="font-semibold text-gray-900 dark:text-white">
								Stripe
							</h3>
							<p class="text-sm text-gray-500 dark:text-gray-400">
								{i18n.lang === "zh"
									? "支持信用卡、借记卡"
									: "Credit & Debit Cards"}
							</p>
						</div>
					</div>
					<p class="text-sm text-gray-600 dark:text-gray-300">
						{i18n.lang === "zh"
							? "安全便捷的在线支付，支持全球主要信用卡"
							: "Secure online payment supporting major credit cards worldwide"}
					</p>
				</div>
			{/if}

			{#if paymentMethods.includes("alipay") || paymentMethods.includes("epay")}
				<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
					<div class="flex items-center gap-3 mb-4">
						<div
							class="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center"
						>
							<span class="text-2xl">💰</span>
						</div>
						<div>
							<h3 class="font-semibold text-gray-900 dark:text-white">
								EPay / Alipay
							</h3>
							<p class="text-sm text-gray-500 dark:text-gray-400">
								{i18n.lang === "zh"
									? "支持支付宝、微信支付"
									: "Alipay & WeChat Pay"}
							</p>
						</div>
					</div>
					<p class="text-sm text-gray-600 dark:text-gray-300">
						{i18n.lang === "zh"
							? "支持多种国内支付方式，快速到账"
							: "Multiple domestic payment methods with instant processing"}
					</p>
				</div>
			{/if}
		</div>
	{:else}
		<div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-orange-100 dark:border-orange-900/30 p-8 mb-8 text-center">
			<div class="w-16 h-16 bg-orange-50 dark:bg-orange-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
				<Clock class="w-8 h-8 text-orange-500" />
			</div>
			<h3 class="text-xl font-bold text-gray-900 dark:text-white mb-2">
				{i18n.t.payment.disabledTitle}
			</h3>
			<p class="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">
				{i18n.t.payment.disabledDesc}
			</p>
			<div class="flex flex-wrap justify-center gap-4">
				<a 
					href="mailto:support@elygate.com"
					class="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-all"
				>
					{i18n.t.payment.contactSupport}
				</a>
			</div>
		</div>
	{/if}

	<!-- Orders History -->
	<div class="bg-white dark:bg-gray-800 rounded-lg shadow">
		<div class="p-6 border-b border-gray-200 dark:border-gray-700">
			<h2 class="text-xl font-semibold text-gray-900 dark:text-white">
				{i18n.lang === "zh" ? "充值记录" : "Payment History"}
			</h2>
		</div>

		{#if loading}
			<div class="p-8 text-center text-gray-500 dark:text-gray-400">
				{i18n.lang === "zh" ? "加载中..." : "Loading..."}
			</div>
		{:else if orders.length === 0}
			<div class="p-8 text-center text-gray-500 dark:text-gray-400">
				{i18n.lang === "zh" ? "暂无充值记录" : "No payment history"}
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full">
					<thead class="bg-gray-50 dark:bg-gray-700">
						<tr>
							<th
								class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
							>
								{i18n.lang === "zh" ? "订单ID" : "Order ID"}
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
							>
								{i18n.lang === "zh" ? "金额" : "Amount"}
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
							>
								{i18n.lang === "zh" ? "支付方式" : "Method"}
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
							>
								{i18n.lang === "zh" ? "状态" : "Status"}
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
							>
								{i18n.lang === "zh" ? "时间" : "Time"}
							</th>
						</tr>
					</thead>
					<tbody
						class="divide-y divide-gray-200 dark:divide-gray-700"
					>
						{#each orders as order}
							{@const StatusIcon = getStatusIcon(order.status)}
							<tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
								<td
									class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white"
								>
									#{order.id}
								</td>
								<td
									class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white"
								>
									{formatAmount(order.amount)}
								</td>
								<td
									class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300"
								>
									{order.payment_method.toUpperCase()}
								</td>
								<td class="px-6 py-4 whitespace-nowrap">
									<span
										class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium {order.status ===
										1
											? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
											: order.status === 0
												? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
												: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}"
									>
										<StatusIcon class="w-3 h-3" />
										{getStatusText(order.status)}
									</span>
								</td>
								<td
									class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300"
								>
									{formatDate(order.created_at)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<!-- Payment Modal -->
{#if showPaymentModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
		onmousedown={handleMouseDown}
		onclick={handleBackdropClick}
	>
		<div
			class="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="p-6 border-b border-gray-200 dark:border-gray-700">
				<h3 class="text-xl font-semibold text-gray-900 dark:text-white">
					{i18n.lang === "zh" ? "选择充值金额" : "Select Amount"}
				</h3>
			</div>

			<div class="p-6">
				<!-- Amount Selection -->
				<div class="grid grid-cols-2 gap-3 mb-6">
					{#each amounts as amount}
						<button
							onclick={() => (selectedAmount = amount.value)}
							class="p-4 border-2 rounded-lg text-center transition {selectedAmount ===
							amount.value
								? 'border-blue-500 bg-blue-50 dark:bg-blue-900'
								: 'border-gray-200 dark:border-gray-600 hover:border-blue-300'}"
						>
							<div
								class="text-lg font-semibold text-gray-900 dark:text-white"
							>
								{amount.label}
							</div>
						</button>
					{/each}
				</div>

				<!-- Payment Method Selection -->
				<div class="mb-6">
					<div
						class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
					>
						{i18n.t.payment.method}
					</div>
					<div class="space-y-2">
						{#if paymentMethods.includes("stripe")}
							<label
								class="flex items-center p-3 border rounded-lg cursor-pointer {selectedMethod ===
								'stripe'
									? 'border-blue-500 bg-blue-50 dark:bg-blue-900'
									: 'border-gray-200 dark:border-gray-600'}"
							>
								<input
									type="radio"
									name="paymentMethod"
									value="stripe"
									bind:group={selectedMethod}
									class="mr-3"
								/>
								<span class="text-gray-900 dark:text-white"
									>Stripe (Credit Card)</span
								>
							</label>
						{/if}

						{#if paymentMethods.includes("alipay") || paymentMethods.includes("epay")}
							<label
								class="flex items-center p-3 border rounded-lg cursor-pointer {selectedMethod ===
								'alipay' || selectedMethod === 'epay'
									? 'border-blue-500 bg-blue-50 dark:bg-blue-900'
									: 'border-gray-200 dark:border-gray-600'}"
							>
								<input
									type="radio"
									name="paymentMethod"
									value={paymentMethods.includes("alipay") ? "alipay" : "epay"}
									bind:group={selectedMethod}
									class="mr-3"
								/>
								<span class="text-gray-900 dark:text-white"
									>Alipay / WeChat Pay</span
								>
							</label>
						{/if}
					</div>
				</div>

				<!-- Actions -->
				<div class="flex gap-3">
					<button
						onclick={() => (showPaymentModal = false)}
						class="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
					>
						{i18n.t.common.cancel}
					</button>
					<button
						onclick={createPayment}
						disabled={loading}
						class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
					>
						{loading ? i18n.t.common.loading : i18n.t.payment.topup}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
