import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import type { UserRecord } from '../types';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const EPAY_APP_ID = process.env.EPAY_APP_ID || '';
const EPAY_APP_SECRET = process.env.EPAY_APP_SECRET || '';
const EPAY_GATEWAY = process.env.EPAY_GATEWAY || 'https://api.epay.com';

export const paymentRouter = new Elysia({ prefix: '/payment' })
    .use(
        new Elysia()
            .use(authPlugin)
            .post('/create-order', async ({ body, user, set }: any) => {
                try {
                    const { amount, paymentMethod } = body;
                    const u = user as UserRecord;
                    const userId = u.id;

                    if (!userId || !amount || amount <= 0) {
                set.status = 400;
                return { success: false, message: 'Invalid parameters' };
            }

            const [dbUser] = await sql`
                SELECT id, username FROM users WHERE id = ${userId} LIMIT 1
            `;

            if (!dbUser) {
                set.status = 404;
                return { success: false, message: 'User not found' };
            }

            const [order] = await sql`
                INSERT INTO payment_orders (user_id, amount, payment_method, status)
                VALUES (${userId}, ${amount}, ${paymentMethod}, 0)
                RETURNING *
            `;

            let paymentUrl = '';

            if (paymentMethod === 'stripe' && STRIPE_SECRET_KEY) {
                const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({
                        'payment_method_types[]': 'card',
                        'line_items[0][price_data][currency]': 'usd',
                        'line_items[0][price_data][product_data][name]': `Elygate Top-up - $${(amount / 1000).toFixed(2)}`,
                        'line_items[0][price_data][unit_amount]': String(amount),
                        'line_items[0][quantity]': '1',
                        'mode': 'payment',
                        'success_url': `${process.env.WEB_URL}/payment/success?order_id=${order.id}`,
                        'cancel_url': `${process.env.WEB_URL}/payment/cancel?order_id=${order.id}`,
                        'metadata[order_id]': String(order.id),
                        'metadata[user_id]': String(userId)
                    })
                });

                const session = await stripeResponse.json() as any;
                paymentUrl = session.url;
            } else if (paymentMethod === 'epay' && EPAY_APP_ID && EPAY_APP_SECRET) {
                const params = new URLSearchParams({
                    pid: EPAY_APP_ID,
                    type: 'alipay',
                    out_trade_no: `ELY${order.id}${Date.now()}`,
                    notify_url: `${process.env.GATEWAY_URL}/api/payment/epay/callback`,
                    return_url: `${process.env.WEB_URL}/payment/success?order_id=${order.id}`,
                    name: `Elygate Top-up - $${(amount / 1000).toFixed(2)}`,
                    money: (amount / 1000).toFixed(2)
                });

                const sign = generateEPaySign(params.toString(), EPAY_APP_SECRET);
                paymentUrl = `${EPAY_GATEWAY}/submit.php?${params}&sign=${sign}&sign_type=MD5`;
            }

            return {
                success: true,
                orderId: order.id,
                paymentUrl
            };
        } catch (e: any) {
            console.error('[Payment] Create order error:', e);
            set.status = 500;
            return { success: false, message: e.message };
        }
    }, {
        body: t.Object({
            amount: t.Number(),
            paymentMethod: t.String()
        })
    })
    )
    .post('/stripe/callback', async ({ body, set }: any) => {
        try {
            const { data } = body;
            const orderId = data?.object?.metadata?.order_id;

            if (!orderId) {
                set.status = 400;
                return { success: false, message: 'Invalid callback data' };
            }

            const [order] = await sql`
                SELECT * FROM payment_orders WHERE id = ${Number(orderId)} LIMIT 1
            `;

            if (!order || order.status !== 0) {
                return { success: true };
            }

            await sql`
                UPDATE payment_orders 
                SET status = 1, transaction_id = ${data.object.id}, updated_at = NOW()
                WHERE id = ${order.id}
            `;

            await sql`
                UPDATE users 
                SET quota = quota + ${order.amount}
                WHERE id = ${order.user_id}
            `;

            console.log(`[Payment] Stripe payment success: Order ${orderId}, User ${order.user_id}, Amount ${order.amount}`);

            return { success: true };
        } catch (e: any) {
            console.error('[Payment] Stripe callback error:', e);
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .post('/epay/callback', async ({ body, query, set }: any) => {
        try {
            const params = new URLSearchParams(query);
            const sign = params.get('sign');

            params.delete('sign');
            params.delete('sign_type');

            const expectedSign = generateEPaySign(params.toString(), EPAY_APP_SECRET);

            if (sign !== expectedSign) {
                set.status = 400;
                return 'fail';
            }

            const outTradeNo = params.get('out_trade_no') || '';
            // Fix EPay out_trade_no parsing: out_trade_no is 'ELY' + orderId + timestamp.
            // E.g., 'ELY1231700000000000'. If timestamp is 13 digits, length might vary.
            // A safer approach is to strip 'ELY' and find the orderId, or extract orderId using regex.
            const match = outTradeNo.match(/^ELY(\d+)\d{13}$/);
            const orderIdStr = match ? match[1] : outTradeNo.replace('ELY', '').substring(0, outTradeNo.length - 16); // Fallback
            const orderId = parseInt(orderIdStr || outTradeNo.replace('ELY', ''));

            const [order] = await sql`
                SELECT * FROM payment_orders WHERE id = ${orderId} LIMIT 1
            `;

            if (!order || order.status !== 0) {
                return 'success';
            }

            await sql`
                UPDATE payment_orders 
                SET status = 1, transaction_id = ${params.get('trade_no')}, updated_at = NOW()
                WHERE id = ${order.id}
            `;

            await sql`
                UPDATE users 
                SET quota = quota + ${order.amount}
                WHERE id = ${order.user_id}
            `;

            console.log(`[Payment] EPay payment success: Order ${orderId}, User ${order.user_id}, Amount ${order.amount}`);

            return 'success';
        } catch (e: any) {
            console.error('[Payment] EPay callback error:', e);
            return 'fail';
        }
    })

    .get('/options', async () => {
        const rows = await sql`SELECT key, value FROM options`;
        // Convert array of {key, value} to a single record object
        const settings: Record<string, string> = {};
        for (const r of rows) settings[r.key] = r.value;
        return settings;
    })
    .use(
        new Elysia()
            .use(authPlugin)
            .get('/orders/:userId', async ({ params: { userId }, user, set }: any) => {
                try {
                    const u = user as UserRecord;
                    if (u.id !== Number(userId) && u.role !== 10) {
                        set.status = 403;
                        return { success: false, message: 'Forbidden' };
                    }
                    const orders = await sql`
                        SELECT * FROM payment_orders 
                        WHERE user_id = ${Number(userId)}
                        ORDER BY created_at DESC
                        LIMIT 50
                    `;
                    return orders;
                } catch (e: any) {
                    set.status = 500;
                    return { success: false, message: e.message };
                }
            })
    );

function generateEPaySign(params: string, secret: string): string {
    return new Bun.CryptoHasher("md5").update(params + secret).digest("hex");
}
