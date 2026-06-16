import { config } from '../config';
import { apiUrls } from '../config';
import { log } from './logger';

/**
 * Creem 支付集成
 * Creem 是面向 SaaS 的支付平台，API 风格类似 Stripe。
 * 文档: https://docs.creem.io
 */

interface CreemCheckoutParams {
    amount: number; // 美分
    productName: string;
    orderId: string;
    userId: number;
    successUrl: string;
    cancelUrl: string;
    productId?: string;
}

export async function createCreemCheckoutSession(params: CreemCheckoutParams): Promise<string> {
    if (!config.creem.apiKey) throw new Error('Creem API key not configured');

    const body: Record<string, any> = {
        amount: params.amount,
        currency: 'USD',
        product_name: params.productName,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: {
            order_id: params.orderId,
            user_id: String(params.userId),
        },
    };
    if (params.productId || config.creem.productId) {
        body.product_id = params.productId || config.creem.productId;
    }

    const res = await fetch(`${apiUrls.creem}/v1/checkouts`, {
        method: 'POST',
        headers: {
            'x-api-key': config.creem.apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const data = await res.json() as Record<string, any>;
    if (!data.checkout_url && !data.url) {
        throw new Error(`Creem error: ${data.message || data.error || 'Unknown error'}`);
    }
    return data.checkout_url || data.url;
}

/**
 * 验证 Creem webhook 签名
 */
export function verifyCreemWebhookSignature(rawBody: string, signature: string): boolean {
    if (!config.creem.webhookSecret) return false;
    const expected = new Bun.CryptoHasher('sha256', config.creem.webhookSecret)
        .update(rawBody)
        .digest('hex');
    return expected === signature;
}

/**
 * 从 Creem webhook 事件中提取订单信息
 */
export function parseCreemWebhookEvent(payload: Record<string, any>): {
    orderId: string;
    eventType: string;
    amount: number;
    transactionId: string;
} | null {
    const eventType = payload.event_type || payload.type || '';
    const obj = payload.object || payload.data || payload;

    if (!obj.metadata?.order_id) return null;

    return {
        orderId: String(obj.metadata.order_id),
        eventType,
        amount: Number(obj.amount || obj.total || 0),
        transactionId: String(obj.id || obj.transaction_id || obj.checkout_id || ''),
    };
}
