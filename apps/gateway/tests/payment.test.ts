import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '@elygate/db';
import {
    completePendingSubscriptionPaymentOrderTx,
    completePendingTopupPaymentOrderTx,
} from '../src/services/paymentCallback';

type PaymentUpdateCall = {
    table: unknown;
    values?: Record<string, unknown>;
    condition?: unknown;
    returnedFields?: Record<string, unknown>;
};

function createPaymentUpdateTx(returningRows: Array<any[]>) {
    const calls: PaymentUpdateCall[] = [];

    const tx = {
        update(table: unknown) {
            const call: PaymentUpdateCall = { table };
            calls.push(call);

            const builder = {
                set(values: Record<string, unknown>) {
                    call.values = values;
                    return builder;
                },
                where(condition: unknown) {
                    call.condition = condition;
                    return builder;
                },
                returning(returnedFields: Record<string, unknown>) {
                    call.returnedFields = returnedFields;
                    return Promise.resolve(returningRows.shift() || []);
                },
            };

            return builder;
        },
    };

    return { tx, calls };
}

describe('Payment callback idempotency helpers', () => {
    test('fulfills a pending topup order exactly once', async () => {
        const order = { id: 101, amount: 1200, userId: 7, paymentMethod: 'stripe' };
        const { tx, calls } = createPaymentUpdateTx([[order]]);
        const fulfilled: unknown[] = [];

        const result = await completePendingTopupPaymentOrderTx(tx, order.id, 'evt_101', async (_tx, pendingOrder) => {
            fulfilled.push(pendingOrder);
        });

        expect(result).toEqual(order);
        expect(fulfilled).toEqual([order]);
        expect(calls).toHaveLength(1);
        expect(calls[0].values?.status).toBe(1);
        expect(calls[0].values?.transactionId).toBe('evt_101');
        expect(calls[0].values?.updatedAt).toBeInstanceOf(Date);
    });

    test('does not fulfill a topup order after it is no longer pending', async () => {
        const { tx } = createPaymentUpdateTx([[]]);
        const fulfilled: unknown[] = [];

        const result = await completePendingTopupPaymentOrderTx(tx, 101, 'evt_duplicate', async (_tx, pendingOrder) => {
            fulfilled.push(pendingOrder);
        });

        expect(result).toBeNull();
        expect(fulfilled).toHaveLength(0);
    });

    test('fulfills a pending subscription order exactly once', async () => {
        const order = {
            id: 202,
            userId: 7,
            packageId: 3,
            paymentMethod: 'epay',
            paymentProvider: 'epay',
            amount: 500000,
            money: '50.00',
        };
        const { tx, calls } = createPaymentUpdateTx([[order]]);
        const fulfilled: unknown[] = [];

        const result = await completePendingSubscriptionPaymentOrderTx(
            tx,
            { tradeNo: 'ELYSUB202' },
            'epay',
            'trade_202',
            { out_trade_no: 'ELYSUB202' },
            async (_tx, pendingOrder) => {
                fulfilled.push(pendingOrder);
            },
        );

        expect(result).toEqual(order);
        expect(fulfilled).toEqual([order]);
        expect(calls).toHaveLength(1);
        expect(calls[0].values?.status).toBe('success');
        expect(calls[0].values?.paymentProvider).toBe('epay');
        expect(calls[0].values?.transactionId).toBe('trade_202');
        expect(calls[0].values?.providerPayload).toBe(JSON.stringify({ out_trade_no: 'ELYSUB202' }));
        expect(calls[0].values?.completedAt).toBeInstanceOf(Date);
    });

    test('does not fulfill a subscription order after it is no longer pending', async () => {
        const { tx } = createPaymentUpdateTx([[]]);
        const fulfilled: unknown[] = [];

        const result = await completePendingSubscriptionPaymentOrderTx(
            tx,
            { orderId: 202 },
            'stripe',
            'evt_duplicate',
            { id: 'evt_duplicate' },
            async (_tx, pendingOrder) => {
                fulfilled.push(pendingOrder);
            },
        );

        expect(result).toBeNull();
        expect(fulfilled).toHaveLength(0);
    });
});

const describeWithDatabase = process.env.PAYMENT_DB_TESTS === '1' ? describe : describe.skip;

describeWithDatabase('Payment System Tests', () => {
    let testUserId: number;
    let testOrderId: number;

    beforeAll(async () => {
        const [user] = await sql`
            INSERT INTO users (username, password_hash, role, quota, status)
            VALUES ('test_payment_user', 'test_hash', 1, 100000, 1)
            RETURNING id
        `;
        testUserId = user.id;
    });

    afterAll(async () => {
        await sql`DELETE FROM payment_orders WHERE user_id = ${testUserId}`;
        await sql`DELETE FROM users WHERE id = ${testUserId}`;
    });

    test('should create payment order', async () => {
        const [order] = await sql`
            INSERT INTO payment_orders (user_id, amount, payment_method, status)
            VALUES (${testUserId}, 10000, 'stripe', 0)
            RETURNING *
        `;
        
        expect(order).toBeDefined();
        expect(order.user_id).toBe(testUserId);
        expect(order.amount).toBe(10000);
        expect(order.payment_method).toBe('stripe');
        expect(order.status).toBe(0);
        
        testOrderId = order.id;
    });

    test('should update payment status', async () => {
        const [updated] = await sql`
            UPDATE payment_orders 
            SET status = 1, transaction_id = 'test_txn_123', updated_at = NOW()
            WHERE id = ${testOrderId}
            RETURNING *
        `;
        
        expect(updated.status).toBe(1);
        expect(updated.transaction_id).toBe('test_txn_123');
    });

    test('should add quota to user after payment', async () => {
        const [beforeUser] = await sql`
            SELECT quota FROM users WHERE id = ${testUserId}
        `;
        
        const quotaBefore = beforeUser.quota;
        
        await sql`
            UPDATE users 
            SET quota = quota + 10000
            WHERE id = ${testUserId}
        `;
        
        const [afterUser] = await sql`
            SELECT quota FROM users WHERE id = ${testUserId}
        `;
        
        expect(afterUser.quota).toBe(quotaBefore + 10000);
    });

    test('should query user orders', async () => {
        const orders = await sql`
            SELECT * FROM payment_orders 
            WHERE user_id = ${testUserId}
            ORDER BY created_at DESC
        `;
        
        expect(orders.length).toBeGreaterThan(0);
        expect(orders[0].user_id).toBe(testUserId);
    });

    test('should handle EPay order', async () => {
        const [epayOrder] = await sql`
            INSERT INTO payment_orders (user_id, amount, payment_method, status)
            VALUES (${testUserId}, 5000, 'epay', 0)
            RETURNING *
        `;
        
        expect(epayOrder.payment_method).toBe('epay');
        expect(epayOrder.amount).toBe(5000);
    });

    test('should prevent duplicate payment processing', async () => {
        const [order] = await sql`
            SELECT * FROM payment_orders WHERE id = ${testOrderId}
        `;
        
        expect(order.status).toBe(1);
        
        const result = await sql`
            UPDATE payment_orders 
            SET status = 1 
            WHERE id = ${testOrderId} AND status = 0
        `;
        
        expect(result.length).toBe(0);
    });
});
