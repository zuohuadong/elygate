import { config } from '../config';
import { apiUrls } from '../config';
import { log } from './logger';

/**
 * Waffo 支付集成
 * Waffo 是面向开发者的支付平台，API 风格类似 EPay + REST。
 * 文档: https://docs.waffo.dev
 */

interface WaffoCheckoutParams {
    amount: number; // 美分
    productName: string;
    orderId: string;
    userId: number;
    successUrl: string;
    cancelUrl: string;
    notifyUrl: string;
}

export async function createWaffoCheckoutSession(params: WaffoCheckoutParams): Promise<string> {
    if (!config.waffo.apiKey) throw new Error('Waffo API key not configured');

    const body = {
        merchant_id: config.waffo.merchantId,
        api_key: config.waffo.apiKey,
        amount: (params.amount / 100).toFixed(2),
        currency: 'USD',
        product_name: params.productName,
        order_id: params.orderId,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        notify_url: params.notifyUrl,
        metadata: { user_id: String(params.userId) },
    };

    const res = await fetch(`${apiUrls.waffo}/v1/payments/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const data = await res.json() as Record<string, any>;
    if (data.code !== 0 && data.success === false) {
        throw new Error(`Waffo error: ${data.message || data.msg || 'Unknown error'}`);
    }
    const url = data.payment_url || data.data?.payment_url || data.url;
    if (!url) throw new Error('Waffo: no payment URL in response');
    return url;
}

/**
 * 验证 Waffo webhook 签名
 */
export function verifyWaffoWebhookSignature(rawBody: string, signature: string, secret = config.waffo.webhookSecret): boolean {
    if (!secret) return false;
    const expected = new Bun.CryptoHasher('sha256', secret)
        .update(rawBody)
        .digest('hex');
    return expected === signature;
}

/**
 * 从 Waffo webhook 回调中提取订单信息
 */
export function parseWaffoWebhookEvent(query: Record<string, any>, body: Record<string, any>): {
    orderId: string;
    status: string;
    amount: number;
    transactionId: string;
} | null {
    const orderId = String(query?.order_id || body?.order_id || body?.metadata?.order_id || '');
    if (!orderId) return null;

    const status = String(query?.status || body?.status || body?.trade_status || '');
    const amount = Number(query?.amount || body?.amount || body?.money || 0);
    const transactionId = String(query?.transaction_id || body?.transaction_id || body?.trade_no || '');

    return { orderId, status, amount, transactionId };
}
