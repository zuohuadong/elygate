import { N as escape_html, m as stringify, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import { t as Circle_check } from "../../../chunks/circle-check.js";
import { t as Circle_x } from "../../../chunks/circle-x.js";
import { t as Clock } from "../../../chunks/clock.js";
import { t as Credit_card } from "../../../chunks/credit-card.js";
import { t as i18n } from "../../../chunks/index.svelte.js";
import { t as session } from "../../../chunks/session.js";
//#region src/routes/payment/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let balance = 0;
		let orders = [];
		let paymentMethods = [];
		function formatAmount(amount) {
			return `${session.currency === "RMB" ? "¥" : "$"}${(amount / session.quotaPerUnit * (session.currency === "RMB" ? session.exchangeRate : 1)).toFixed(2)}`;
		}
		function formatDate(date) {
			return new Date(date).toLocaleString();
		}
		function getStatusText(status) {
			switch (status) {
				case 0: return i18n.lang === "zh" ? "待支付" : "Pending";
				case 1: return i18n.lang === "zh" ? "已完成" : "Completed";
				case 2: return i18n.lang === "zh" ? "已失败" : "Failed";
				default: return i18n.lang === "zh" ? "未知" : "Unknown";
			}
		}
		function getStatusIcon(status) {
			switch (status) {
				case 0: return Clock;
				case 1: return Circle_check;
				case 2: return Circle_x;
				default: return Clock;
			}
		}
		$$renderer.push(`<div class="container mx-auto p-6"><div class="mb-8"><h1 class="text-3xl font-bold text-gray-900 dark:text-white">${escape_html(i18n.lang === "zh" ? "充值中心" : "Payment Center")}</h1> <p class="text-gray-600 dark:text-gray-400 mt-2">${escape_html(i18n.lang === "zh" ? "管理您的账户余额和支付订单" : "Manage your account balance and payment orders")}</p></div> <div class="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-8 text-white shadow-lg mb-8"><div class="flex items-center justify-between"><div class="flex-1"><h1 class="text-3xl font-bold mb-2">${escape_html(i18n.t.payment.balance)}</h1> <p class="text-blue-100 text-lg opacity-90">${escape_html(formatAmount(balance))}</p></div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<button class="bg-white text-blue-600 px-6 py-3 rounded-lg font-semibold hover:bg-opacity-90 transition flex items-center gap-2">`);
		Credit_card($$renderer, { class: "w-5 h-5" });
		$$renderer.push(`<!----> ${escape_html(i18n.t.payment.topup)}</button>`);
		$$renderer.push(`<!--]--></div></div> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">`);
		if (paymentMethods.includes("stripe")) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6"><div class="flex items-center gap-3 mb-4"><div class="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center"><span class="text-2xl">💳</span></div> <div><h3 class="font-semibold text-gray-900 dark:text-white">Stripe</h3> <p class="text-sm text-gray-500 dark:text-gray-400">${escape_html(i18n.lang === "zh" ? "支持信用卡、借记卡" : "Credit & Debit Cards")}</p></div></div> <p class="text-sm text-gray-600 dark:text-gray-300">${escape_html(i18n.lang === "zh" ? "安全便捷的在线支付，支持全球主要信用卡" : "Secure online payment supporting major credit cards worldwide")}</p></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (paymentMethods.includes("alipay") || paymentMethods.includes("epay")) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6"><div class="flex items-center gap-3 mb-4"><div class="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center"><span class="text-2xl">💰</span></div> <div><h3 class="font-semibold text-gray-900 dark:text-white">EPay / Alipay</h3> <p class="text-sm text-gray-500 dark:text-gray-400">${escape_html(i18n.lang === "zh" ? "支持支付宝、微信支付" : "Alipay & WeChat Pay")}</p></div></div> <p class="text-sm text-gray-600 dark:text-gray-300">${escape_html(i18n.lang === "zh" ? "支持多种国内支付方式，快速到账" : "Multiple domestic payment methods with instant processing")}</p></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
		$$renderer.push(`<!--]--> <div class="bg-white dark:bg-gray-800 rounded-lg shadow"><div class="p-6 border-b border-gray-200 dark:border-gray-700"><h2 class="text-xl font-semibold text-gray-900 dark:text-white">${escape_html(i18n.lang === "zh" ? "充值记录" : "Payment History")}</h2></div> `);
		if (orders.length === 0) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="p-8 text-center text-gray-500 dark:text-gray-400">${escape_html(i18n.lang === "zh" ? "暂无充值记录" : "No payment history")}</div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="overflow-x-auto"><table class="w-full"><thead class="bg-gray-50 dark:bg-gray-700"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${escape_html(i18n.lang === "zh" ? "订单ID" : "Order ID")}</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${escape_html(i18n.lang === "zh" ? "金额" : "Amount")}</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${escape_html(i18n.lang === "zh" ? "支付方式" : "Method")}</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${escape_html(i18n.lang === "zh" ? "状态" : "Status")}</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">${escape_html(i18n.lang === "zh" ? "时间" : "Time")}</th></tr></thead><tbody class="divide-y divide-gray-200 dark:divide-gray-700"><!--[-->`);
			const each_array = ensure_array_like(orders);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let order = each_array[$$index];
				const StatusIcon = getStatusIcon(order.status);
				$$renderer.push(`<tr class="hover:bg-gray-50 dark:hover:bg-gray-700"><td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">#${escape_html(order.id)}</td><td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">${escape_html(formatAmount(order.amount))}</td><td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escape_html(order.payment_method.toUpperCase())}</td><td class="px-6 py-4 whitespace-nowrap"><span${attr_class(`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${stringify(order.status === 1 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : order.status === 0 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200")}`)}>`);
				if (StatusIcon) {
					$$renderer.push("<!--[-->");
					StatusIcon($$renderer, { class: "w-3 h-3" });
					$$renderer.push("<!--]-->");
				} else {
					$$renderer.push("<!--[!-->");
					$$renderer.push("<!--]-->");
				}
				$$renderer.push(` ${escape_html(getStatusText(order.status))}</span></td><td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">${escape_html(formatDate(order.created_at))}</td></tr>`);
			}
			$$renderer.push(`<!--]--></tbody></table></div>`);
		}
		$$renderer.push(`<!--]--></div></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
export { _page as default };
