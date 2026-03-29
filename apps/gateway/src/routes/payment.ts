import type { ElysiaCtx } from '../types';
import { config, apiUrls } from '../config';
import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import { optionCache } from '../services/optionCache';

const STRIPE_SECRET_KEY = config.stripe.secretKey || '';
const STRIPE_WEBHOOK_SECRET = config.stripe.webhookSecret || '';
const EPAY_APP_ID = config.epay.appId || '';
const EPAY_APP_SECRET = config.epay.appSecret || '';
const EPAY_GATEWAY = config.epay.gateway || 'https://api.epay.com';

export const paymentRouter = new Elysia({ prefix: '/payment' })
    .use(authPlugin)

    // Create a new payment order (authenticated: userId comes from token, not request body)
    .post('/create-order', async ({ body, user, set }: ElysiaCtx) => {
        try {
            // Safeguard: Check if payment is enabled first
            const [paymentEnabled] = await sql`SELECT value FROM options WHERE key = 'PaymentEnabled'`;
            if (paymentEnabled && paymentEnabled.value === 'false') {
                set.status = 403;
                return { success: false, message: 'Self-recharge is currently disabled' };
            }

            const { amount, paymentMethod } = body;

            if (!amount || amount <= 0) {
                set.status = 400;
                return { success: false, message: 'Invalid amount' };
            }

            // Use authenticated user's ID — never trust client-provided userId
            const userId = user.id;

            const [order] = await sql`
                INSERT INTO payment_orders (user_id, amount, payment_method, status)
                VALUES (${userId}, ${amount}, ${paymentMethod}, 0)
                RETURNING *
            `;

            let paymentUrl = '';

            if (paymentMethod === 'stripe' && STRIPE_SECRET_KEY) {
                const stripeResponse = await fetch(apiUrls.stripe + '/v1/checkout/sessions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({
                        'payment_method_types[]': 'card',
                        'line_items[0][price_data][currency]': 'usd',
                        'line_items[0][price_data][product_data][name]': `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
                        'line_items[0][price_data][unit_amount]': String(amount),
                        'line_items[0][quantity]': '1',
                        'mode': 'payment',
                        'success_url': `${config.webUrl}/payment/success?order_id=${order.id}`,
                        'cancel_url': `${config.webUrl}/payment/cancel?order_id=${order.id}`,
                        'metadata[order_id]': String(order.id),
                        'metadata[user_id]': String(userId)
                    })
                });

                const session = await stripeResponse.json() as Record<string, any>;
                if (!session.url) {
                    throw new Error(`Stripe error: ${session.error?.message || 'Unknown error'}`);
                }
                paymentUrl = session.url;
            } else if (paymentMethod === 'epay' && EPAY_APP_ID && EPAY_APP_SECRET) {
                // Store orderId in out_trade_no with a simpler, parseable format: ELY{orderId}
                const outTradeNo = `ELY${order.id}`;
                const params = new URLSearchParams({
                    pid: EPAY_APP_ID,
                    type: 'alipay',
                    out_trade_no: outTradeNo,
                    notify_url: `${config.gatewayUrl}/api/payment/epay/callback`,
                    return_url: `${config.webUrl}/payment/success?order_id=${order.id}`,
                    name: `Elygate Top-up - $${(amount / 100).toFixed(2)}`,
                    money: (amount / 100).toFixed(2)
                });

                // Sort params as required by EPay spec
                const sortedParams = new URLSearchParams([...params.entries()].sort());
                const sign = await generateEPaySign(sortedParams.toString(), EPAY_APP_SECRET);
                paymentUrl = `${EPAY_GATEWAY}/submit.php?${sortedParams}&sign=${sign}&sign_type=MD5`;
            }

            return {
                success: true,
                orderId: order.id,
                paymentUrl
            };
        } catch (e: unknown) {
            log.error('[Payment] Create order error:', e);
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            amount: t.Number(),
            paymentMethod: t.String()
        })
    })

    // Stripe webhook callback — verify Stripe-Signature header
    .post('/stripe/callback', async ({ body, request, set }: ElysiaCtx) => {
        try {
            // Verify Stripe webhook signature if webhook secret is configured
            if (STRIPE_WEBHOOK_SECRET) {
                const sigHeader = request.headers.get('stripe-signature');
                if (!sigHeader) {
                    set.status = 400;
                    return { success: false, message: 'Missing Stripe signature' };
                }

                const rawBody = await request.text().catch((e: unknown) => { log.warn("[Fallback]", e); return ''; });
                const parts = sigHeader.split(',').reduce((acc: Record<string, string>, part: string) => {
                    const [k, v] = part.split('=');
                    acc[k] = v;
                    return acc;
                }, {});

                const timestamp = parts['t'];
                const receivedSig = parts['v1'];

                // HMAC-SHA256 verification via Bun native API
                const expectedSig = new Bun.CryptoHasher('sha256', STRIPE_WEBHOOK_SECRET)
                    .update(`${timestamp}.${rawBody}`)
                    .digest('hex');

                if (expectedSig !== receivedSig) {
                    set.status = 400;
                    return { success: false, message: 'Invalid Stripe signature' };
                }
            }

            const { data } = body;
            const orderId = data?.object?.metadata?.order_id;

            if (!orderId) {
                set.status = 400;
                return { success: false, message: 'Invalid callback data' };
            }

            // Atomic: update order status AND add quota in single transaction
            await sql.begin(async (tx: any) => {
                const [order] = await tx`
                    UPDATE payment_orders
                    SET status = 1, transaction_id = ${data.object.id}, updated_at = NOW()
                    WHERE id = ${Number(orderId)} AND status = 0
                    RETURNING *
                `;

                if (!order) return; // Already processed (idempotent)

                const quotaPerUnit = Number(optionCache.get('QuotaPerUnit') || 500000);
                const quotaToAdd = Math.floor((order.amount / 100) * quotaPerUnit);

                await tx`
                    UPDATE users 
                    SET quota = quota + ${quotaToAdd}
                    WHERE id = ${order.user_id}
                `;

                log.info(`[Payment] Stripe success: Order ${orderId}, User ${order.user_id}, Amount ${order.amount}, QuotaAdded ${quotaToAdd}`);
            });

            return { success: true };
        } catch (e: unknown) {
            log.error('[Payment] Stripe callback error:', e);
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // EPay async callback
    .post('/epay/callback', async ({ query, set }: ElysiaCtx) => {
        try {
            const params = new URLSearchParams(query);
            const sign = params.get('sign');

            params.delete('sign');
            params.delete('sign_type');

            // Sort params before verifying signature (EPay spec requirement)
            const sortedParams = new URLSearchParams([...params.entries()].sort());
            const expectedSign = await generateEPaySign(sortedParams.toString(), EPAY_APP_SECRET);

            if (sign !== expectedSign) {
                log.warn('[Payment] EPay signature mismatch, possible forgery attempt');
                set.status = 400;
                return 'fail';
            }

            // Parse orderId from out_trade_no (format: ELY{orderId})
            const outTradeNo = params.get('out_trade_no') || '';
            const orderId = parseInt(outTradeNo.replace(/^ELY/, ''), 10);

            if (isNaN(orderId)) {
                log.error('[Payment] EPay: cannot parse orderId from out_trade_no:', outTradeNo);
                return 'fail';
            }

            // Atomic: update order status AND add quota in single transaction
            await sql.begin(async (tx: any) => {
                const [order] = await tx`
                    UPDATE payment_orders
                    SET status = 1, transaction_id = ${params.get('trade_no')}, updated_at = NOW()
                    WHERE id = ${orderId} AND status = 0
                    RETURNING *
                `;

                if (!order) return; // Already processed (idempotent)

                const quotaPerUnit = Number(optionCache.get('QuotaPerUnit') || 500000);
                const quotaToAdd = Math.floor((order.amount / 100) * quotaPerUnit);

                await tx`
                    UPDATE users 
                    SET quota = quota + ${quotaToAdd}
                    WHERE id = ${order.user_id}
                `;

                log.info(`[Payment] EPay success: Order ${orderId}, User ${order.user_id}, Amount ${order.amount}, QuotaAdded ${quotaToAdd}`);
            });

            return 'success';
        } catch (e: unknown) {
            log.error('[Payment] EPay callback error:', e);
            return 'fail';
        }
    })

    // Get orders for the authenticated user only
    .get('/orders', async ({ user, set }: ElysiaCtx) => {
        try {
            const orders = await sql`
                SELECT * FROM payment_orders 
                WHERE user_id = ${user.id}
                ORDER BY created_at DESC
                LIMIT 50
            `;
            return orders;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .get('/options', async () => {
        const rows = await sql`SELECT key, value FROM options`;
        const settings: Record<string, string> = {};
        for (const r of rows) settings[r.key] = r.value;
        return settings;
    });

/**
 * Generate EPay MD5 signature using Bun native CryptoHasher.
 */
function generateEPaySign(params: string, secret: string): string {
    return new Bun.CryptoHasher('md5').update(params + secret).digest('hex');
}
