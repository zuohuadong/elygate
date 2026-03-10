import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const EPAY_APP_ID = process.env.EPAY_APP_ID || '';
const EPAY_APP_SECRET = process.env.EPAY_APP_SECRET || '';
const EPAY_GATEWAY = process.env.EPAY_GATEWAY || 'https://api.epay.com';

export const paymentRouter = new Elysia({ prefix: '/payment' })
    .use(authPlugin)

    // Create a new payment order (authenticated: userId comes from token, not request body)
    .post('/create-order', async ({ body, user, set }: any) => {
        try {
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
                    notify_url: `${process.env.GATEWAY_URL}/api/payment/epay/callback`,
                    return_url: `${process.env.WEB_URL}/payment/success?order_id=${order.id}`,
                    name: `Elygate Top-up - $${(amount / 1000).toFixed(2)}`,
                    money: (amount / 1000).toFixed(2)
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

    // Stripe webhook callback — verify Stripe-Signature header
    .post('/stripe/callback', async ({ body, request, set }: any) => {
        try {
            // Verify Stripe webhook signature if webhook secret is configured
            if (STRIPE_WEBHOOK_SECRET) {
                const sigHeader = request.headers.get('stripe-signature');
                if (!sigHeader) {
                    set.status = 400;
                    return { success: false, message: 'Missing Stripe signature' };
                }

                const rawBody = await request.text().catch(() => '');
                const parts = sigHeader.split(',').reduce((acc: any, part: string) => {
                    const [k, v] = part.split('=');
                    acc[k] = v;
                    return acc;
                }, {});

                const timestamp = parts['t'];
                const receivedSig = parts['v1'];

                // HMAC-SHA256 verification
                const encoder = new TextEncoder();
                const keyData = encoder.encode(STRIPE_WEBHOOK_SECRET);
                const msgData = encoder.encode(`${timestamp}.${rawBody}`);
                const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
                const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
                const expectedSig = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

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

                await tx`
                    UPDATE users 
                    SET quota = quota + ${order.amount}
                    WHERE id = ${order.user_id}
                `;

                console.log(`[Payment] Stripe success: Order ${orderId}, User ${order.user_id}, Amount ${order.amount}`);
            });

            return { success: true };
        } catch (e: any) {
            console.error('[Payment] Stripe callback error:', e);
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    // EPay async callback
    .post('/epay/callback', async ({ query, set }: any) => {
        try {
            const params = new URLSearchParams(query);
            const sign = params.get('sign');

            params.delete('sign');
            params.delete('sign_type');

            // Sort params before verifying signature (EPay spec requirement)
            const sortedParams = new URLSearchParams([...params.entries()].sort());
            const expectedSign = await generateEPaySign(sortedParams.toString(), EPAY_APP_SECRET);

            if (sign !== expectedSign) {
                console.warn('[Payment] EPay signature mismatch, possible forgery attempt');
                set.status = 400;
                return 'fail';
            }

            // Parse orderId from out_trade_no (format: ELY{orderId})
            const outTradeNo = params.get('out_trade_no') || '';
            const orderId = parseInt(outTradeNo.replace(/^ELY/, ''), 10);

            if (isNaN(orderId)) {
                console.error('[Payment] EPay: cannot parse orderId from out_trade_no:', outTradeNo);
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

                await tx`
                    UPDATE users 
                    SET quota = quota + ${order.amount}
                    WHERE id = ${order.user_id}
                `;

                console.log(`[Payment] EPay success: Order ${orderId}, User ${order.user_id}, Amount ${order.amount}`);
            });

            return 'success';
        } catch (e: any) {
            console.error('[Payment] EPay callback error:', e);
            return 'fail';
        }
    })

    // Get orders for the authenticated user only
    .get('/orders', async ({ user, set }: any) => {
        try {
            const orders = await sql`
                SELECT * FROM payment_orders 
                WHERE user_id = ${user.id}
                ORDER BY created_at DESC
                LIMIT 50
            `;
            return orders;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .get('/options', async () => {
        const rows = await sql`SELECT key, value FROM options`;
        const settings: Record<string, string> = {};
        for (const r of rows) settings[r.key] = r.value;
        return settings;
    });

/**
 * Generate EPay MD5 signature.
 * Note: SubtleCrypto does NOT support MD5 — we implement it manually.
 */
async function generateEPaySign(params: string, secret: string): Promise<string> {
    // Pure JS MD5 implementation (SubtleCrypto only supports SHA-* algorithms)
    const str = params + secret;
    return md5(str);
}

// Minimal MD5 implementation (RFC 1321)
function md5(input: string): string {
    const str = unescape(encodeURIComponent(input));
    const x: number[] = [];
    const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
    const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
    const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
    const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

    function safeAdd(x: number, y: number): number { return (x + y) | 0; }
    function rotateLeft(lValue: number, iShiftBits: number): number { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
    function F(x: number, y: number, z: number): number { return (x & y) | (~x & z); }
    function G(x: number, y: number, z: number): number { return (x & z) | (y & ~z); }
    function H(x: number, y: number, z: number): number { return x ^ y ^ z; }
    function I(x: number, y: number, z: number): number { return y ^ (x | ~z); }
    function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
        return safeAdd(rotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
    }
    function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(F(b, c, d), a, b, x, s, t); }
    function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(G(b, c, d), a, b, x, s, t); }
    function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(H(b, c, d), a, b, x, s, t); }
    function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(I(b, c, d), a, b, x, s, t); }

    function str2blks(str: string): number[] {
        const nblk = ((str.length + 8) >> 6) + 1;
        const blks: number[] = new Array(nblk * 16).fill(0);
        for (let i = 0; i < str.length; i++) blks[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
        blks[str.length >> 2] |= 0x80 << ((str.length % 4) * 8);
        blks[nblk * 16 - 2] = str.length * 8;
        return blks;
    }

    const blks = str2blks(str);
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;

    for (let i = 0; i < blks.length; i += 16) {
        const [olda, oldb, oldc, oldd] = [a, b, c, d];
        a = ff(a, b, c, d, blks[i], S11, -680876936); d = ff(d, a, b, c, blks[i + 1], S12, -389564586); c = ff(c, d, a, b, blks[i + 2], S13, 606105819); b = ff(b, c, d, a, blks[i + 3], S14, -1044525330);
        a = ff(a, b, c, d, blks[i + 4], S11, -176418897); d = ff(d, a, b, c, blks[i + 5], S12, 1200080426); c = ff(c, d, a, b, blks[i + 6], S13, -1473231341); b = ff(b, c, d, a, blks[i + 7], S14, -45705983);
        a = ff(a, b, c, d, blks[i + 8], S11, 1770035416); d = ff(d, a, b, c, blks[i + 9], S12, -1958414417); c = ff(c, d, a, b, blks[i + 10], S13, -42063); b = ff(b, c, d, a, blks[i + 11], S14, -1990404162);
        a = ff(a, b, c, d, blks[i + 12], S11, 1804603682); d = ff(d, a, b, c, blks[i + 13], S12, -40341101); c = ff(c, d, a, b, blks[i + 14], S13, -1502002290); b = ff(b, c, d, a, blks[i + 15], S14, 1236535329);
        a = gg(a, b, c, d, blks[i + 1], S21, -165796510); d = gg(d, a, b, c, blks[i + 6], S22, -1069501632); c = gg(c, d, a, b, blks[i + 11], S23, 643717713); b = gg(b, c, d, a, blks[i], S24, -373897302);
        a = gg(a, b, c, d, blks[i + 5], S21, -701558691); d = gg(d, a, b, c, blks[i + 10], S22, 38016083); c = gg(c, d, a, b, blks[i + 15], S23, -660478335); b = gg(b, c, d, a, blks[i + 4], S24, -405537848);
        a = gg(a, b, c, d, blks[i + 9], S21, 568446438); d = gg(d, a, b, c, blks[i + 14], S22, -1019803690); c = gg(c, d, a, b, blks[i + 3], S23, -187363961); b = gg(b, c, d, a, blks[i + 8], S24, 1163531501);
        a = gg(a, b, c, d, blks[i + 13], S21, -1444681467); d = gg(d, a, b, c, blks[i + 2], S22, -51403784); c = gg(c, d, a, b, blks[i + 7], S23, 1735328473); b = gg(b, c, d, a, blks[i + 12], S24, -1926607734);
        a = hh(a, b, c, d, blks[i + 5], S31, -378558); d = hh(d, a, b, c, blks[i + 8], S32, -2022574463); c = hh(c, d, a, b, blks[i + 11], S33, 1839030562); b = hh(b, c, d, a, blks[i + 14], S34, -35309556);
        a = hh(a, b, c, d, blks[i + 1], S31, -1530992060); d = hh(d, a, b, c, blks[i + 4], S32, 1272893353); c = hh(c, d, a, b, blks[i + 7], S33, -155497632); b = hh(b, c, d, a, blks[i + 10], S34, -1094730640);
        a = hh(a, b, c, d, blks[i + 13], S31, 681279174); d = hh(d, a, b, c, blks[i], S32, -358537222); c = hh(c, d, a, b, blks[i + 3], S33, -722521979); b = hh(b, c, d, a, blks[i + 6], S34, 76029189);
        a = hh(a, b, c, d, blks[i + 9], S31, -640364487); d = hh(d, a, b, c, blks[i + 12], S32, -421815835); c = hh(c, d, a, b, blks[i + 15], S33, 530742520); b = hh(b, c, d, a, blks[i + 2], S34, -995338651);
        a = ii(a, b, c, d, blks[i], S41, -198630844); d = ii(d, a, b, c, blks[i + 7], S42, 1126891415); c = ii(c, d, a, b, blks[i + 14], S43, -1416354905); b = ii(b, c, d, a, blks[i + 5], S44, -57434055);
        a = ii(a, b, c, d, blks[i + 12], S41, 1700485571); d = ii(d, a, b, c, blks[i + 3], S42, -1894986606); c = ii(c, d, a, b, blks[i + 10], S43, -1051523); b = ii(b, c, d, a, blks[i + 1], S44, -2054922799);
        a = ii(a, b, c, d, blks[i + 8], S41, 1873313359); d = ii(d, a, b, c, blks[i + 15], S42, -30611744); c = ii(c, d, a, b, blks[i + 6], S43, -1560198380); b = ii(b, c, d, a, blks[i + 13], S44, 1309151649);
        a = ii(a, b, c, d, blks[i + 4], S41, -145523070); d = ii(d, a, b, c, blks[i + 11], S42, -1120210379); c = ii(c, d, a, b, blks[i + 2], S43, 718787259); b = ii(b, c, d, a, blks[i + 9], S44, -343485551);
        a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
    }

    return [a, b, c, d].map(n => {
        let s = '';
        for (let i = 0; i < 4; i++) s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
        return s;
    }).join('');
}
