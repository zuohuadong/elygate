import type { ElysiaCtx } from '../types';
import { config, apiUrls } from '../config';
import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { Elysia, t } from 'elysia';
import { db } from '@elygate/db';
import { options, paymentOrders, subscriptionOrders, topupLogs, users } from '@elygate/db/schema';
import { and, desc, eq, sql as drizzleSql } from 'drizzle-orm';
import { authPlugin } from '../middleware/auth';
import { optionCache } from '../services/optionCache';
import {
    completePendingSubscriptionPaymentOrderTx,
    completePendingTopupPaymentOrderTx,
} from '../services/paymentCallback';
import { bindSubscriptionToUserTx } from '../services/subscription';
import { isPublicRechargeEnabled } from '../services/paymentPolicy';
import {
    generateEPaySign as generateEPaySignWithSecret,
    verifyStripeWebhookSignature as verifyStripeWebhookSignatureWithSecret,
} from '../services/paymentSignatures';

const STRIPE_SECRET_KEY = config.stripe.secretKey || '';
const STRIPE_WEBHOOK_SECRET = config.stripe.webhookSecret || '';
const EPAY_APP_ID = config.epay.appId || '';
const EPAY_APP_SECRET = config.epay.appSecret || '';
const EPAY_GATEWAY = config.epay.gateway || 'https://api.epay.com';

async function recordTopupLogTx(tx: any, payload: {
    userId: number;
    action: string;
    paymentOrderId?: number | null;
    subscriptionOrderId?: number | null;
    paymentMethod?: string | null;
    paymentProvider?: string | null;
    amount?: number;
    money?: number | string;
    details?: Record<string, unknown>;
}) {
    await tx.insert(topupLogs).values({
        userId: payload.userId,
        paymentOrderId: payload.paymentOrderId ?? null,
        subscriptionOrderId: payload.subscriptionOrderId ?? null,
        action: payload.action,
        paymentMethod: payload.paymentMethod ?? null,
        paymentProvider: payload.paymentProvider ?? null,
        amount: Number(payload.amount || 0),
        money: String(payload.money ?? '0'),
        details: payload.details || {},
    });
}

async function fulfillTopupPaymentOrder(tx: any, order: {
    id: number;
    amount: number;
    userId: number;
    paymentMethod: string;
}) {
    const quotaPerUnit = Number(optionCache.get('QuotaPerUnit') || 500000);
    const quotaToAdd = Math.floor((order.amount / 100) * quotaPerUnit);

    await tx.update(users)
        .set({ quota: drizzleSql`${users.quota} + ${quotaToAdd}` })
        .where(eq(users.id, order.userId));

    await recordTopupLogTx(tx, {
        userId: order.userId,
        action: 'topup_success',
        paymentOrderId: order.id,
        paymentMethod: order.paymentMethod,
        paymentProvider: order.paymentMethod,
        amount: quotaToAdd,
        money: order.amount / 100,
        details: { quotaPerUnit, cents: order.amount },
    });

    log.info(`[Payment] Top-up success: Order ${order.id}, User ${order.userId}, Amount ${order.amount}, QuotaAdded ${quotaToAdd}`);
}

async function fulfillSubscriptionPaymentOrder(tx: any, order: {
    id: number;
    userId: number;
    packageId: number;
    paymentMethod: string;
    paymentProvider: string;
    amount: number;
    money: string | number;
}) {
    const sub = await bindSubscriptionToUserTx(tx, order.userId, order.packageId, 'order');
    await recordTopupLogTx(tx, {
        userId: order.userId,
        action: 'subscription_success',
        subscriptionOrderId: order.id,
        paymentMethod: order.paymentMethod,
        paymentProvider: order.paymentProvider,
        amount: Number(order.amount || 0),
        money: order.money,
        details: { packageId: order.packageId, subscriptionId: sub.id },
    });
    log.info(`[Payment] Subscription success: Order ${order.id}, User ${order.userId}, Package ${order.packageId}`);
}

const authenticatedPaymentRouter = new Elysia()
    .use(authPlugin)
    .post('/create-order', async ({ body, user, set }: ElysiaCtx) => {
        try {
            const [paymentEnabled] = await db.select().from(options).where(eq(options.key, 'PaymentEnabled'));
            if (!isPublicRechargeEnabled(paymentEnabled?.value)) {
                set.status = 403;
                return { success: false, message: 'Self-recharge is currently disabled' };
            }

            const { amount, paymentMethod } = body;
            if (!amount || amount <= 0) {
                set.status = 400;
                return { success: false, message: 'Invalid amount' };
            }

            const [order] = await db.insert(paymentOrders).values({
                userId: user.id,
                amount,
                paymentMethod,
                status: 0,
            }).returning();

            let paymentUrl = '';
            if (paymentMethod === 'stripe' && STRIPE_SECRET_KEY) {
                const stripeResponse = await fetch(apiUrls.stripe + '/v1/checkout/sessions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        'payment_method_types[]': 'card',
                        'line_items[0][price_data][currency]': 'usd',
                        'line_items[0][price_data][product_data][name]': `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
                        'line_items[0][price_data][unit_amount]': String(amount),
                        'line_items[0][quantity]': '1',
                        mode: 'payment',
                        success_url: `${config.webUrl}/payment/success?order_id=${order.id}`,
                        cancel_url: `${config.webUrl}/payment/cancel?order_id=${order.id}`,
                        'metadata[order_id]': String(order.id),
                        'metadata[user_id]': String(user.id),
                        'metadata[order_kind]': 'topup',
                    }),
                });
                const session = await stripeResponse.json() as Record<string, any>;
                if (!session.url) throw new Error(`Stripe error: ${session.error?.message || 'Unknown error'}`);
                paymentUrl = session.url;
            } else if (paymentMethod === 'epay' && EPAY_APP_ID && EPAY_APP_SECRET) {
                const outTradeNo = `ELY${order.id}`;
                const params = new URLSearchParams({
                    pid: EPAY_APP_ID,
                    type: 'alipay',
                    out_trade_no: outTradeNo,
                    notify_url: `${config.gatewayUrl}/api/payment/epay/callback`,
                    return_url: `${config.webUrl}/payment/success?order_id=${order.id}`,
                    name: `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
                    money: (amount / 100).toFixed(2),
                });
                const sortedParams = new URLSearchParams([...params.entries()].sort());
                const sign = generateEPaySign(sortedParams.toString(), EPAY_APP_SECRET);
                paymentUrl = `${EPAY_GATEWAY}/submit.php?${sortedParams}&sign=${sign}&sign_type=MD5`;
            }

            return { success: true, orderId: order.id, paymentUrl };
        } catch (e: unknown) {
            log.error('[Payment] Create order error:', e);
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            amount: t.Number(),
            paymentMethod: t.String(),
        }),
    })
    .get('/orders', async ({ user, set }: ElysiaCtx) => {
        try {
            return await db.select().from(paymentOrders)
                .where(eq(paymentOrders.userId, user.id))
                .orderBy(desc(paymentOrders.createdAt))
                .limit(50);
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })
    .get('/options', async () => {
        const rows = await db.select().from(options);
        const settings: Record<string, string> = {};
        for (const row of rows) settings[row.key] = row.value;
        return settings;
    });

export async function handleStripePaymentCallback({ body, request, set }: ElysiaCtx) {
        try {
            if (STRIPE_WEBHOOK_SECRET) {
                const sigHeader = request.headers.get('stripe-signature');
                if (!sigHeader) {
                    set.status = 400;
                    return { success: false, message: 'Missing Stripe signature' };
                }

                const rawBody = await request.text().catch(() => '');
                if (!verifyStripeWebhookSignature(rawBody, sigHeader)) {
                    set.status = 400;
                    return { success: false, message: 'Invalid Stripe signature' };
                }
            }

            const metadata = body?.data?.object?.metadata || {};
            const orderId = Number(metadata.order_id || 0);
            if (!orderId) {
                set.status = 400;
                return { success: false, message: 'Invalid callback data' };
            }

            const orderKind = String(metadata.order_kind || metadata.order_type || 'topup');
            await db.transaction(async (tx) => {
                if (orderKind === 'subscription') {
                    await completePendingSubscriptionPaymentOrderTx(
                        tx,
                        { orderId },
                        'stripe',
                        body?.data?.object?.id,
                        body?.data?.object || {},
                        fulfillSubscriptionPaymentOrder,
                    );
                    return;
                }

                await completePendingTopupPaymentOrderTx(tx, orderId, body?.data?.object?.id, fulfillTopupPaymentOrder);
            });

            return { success: true };
        } catch (e: unknown) {
            log.error('[Payment] Stripe callback error:', e);
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
}

export async function handleEPayPaymentCallback({ query, set }: ElysiaCtx) {
        try {
            const params = new URLSearchParams(query);
            const sign = params.get('sign');
            params.delete('sign');
            params.delete('sign_type');

            const sortedParams = new URLSearchParams([...params.entries()].sort());
            const expectedSign = generateEPaySign(sortedParams.toString(), EPAY_APP_SECRET);
            if (sign !== expectedSign) {
                log.warn('[Payment] EPay signature mismatch, possible forgery attempt');
                set.status = 400;
                return 'fail';
            }

            const outTradeNo = params.get('out_trade_no') || '';
            const topupMatch = outTradeNo.match(/^ELY(\d+)$/);
            const isSubscriptionTrade = outTradeNo.startsWith('ELYSUB');

            await db.transaction(async (tx) => {
                if (isSubscriptionTrade) {
                    await completePendingSubscriptionPaymentOrderTx(
                        tx,
                        { tradeNo: outTradeNo },
                        'epay',
                        params.get('trade_no'),
                        Object.fromEntries(params.entries()),
                        fulfillSubscriptionPaymentOrder,
                    );
                    return;
                }

                if (!topupMatch) throw new Error(`Cannot parse orderId from out_trade_no: ${outTradeNo}`);
                const orderId = Number(topupMatch[1]);
                await completePendingTopupPaymentOrderTx(tx, orderId, params.get('trade_no'), fulfillTopupPaymentOrder);
            });

            return 'success';
        } catch (e: unknown) {
            log.error('[Payment] EPay callback error:', e);
            return 'fail';
        }
}

export const paymentRouter = new Elysia({ prefix: '/payment' })
    .post('/stripe/callback', handleStripePaymentCallback)
    .post('/epay/callback', handleEPayPaymentCallback)
    .use(authenticatedPaymentRouter);

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string, secret = STRIPE_WEBHOOK_SECRET): boolean {
    return verifyStripeWebhookSignatureWithSecret(rawBody, signatureHeader, secret);
}

export function generateEPaySign(params: string, secret: string): string {
    return generateEPaySignWithSecret(params, secret);
}
