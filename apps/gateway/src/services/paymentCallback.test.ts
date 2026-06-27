import { describe, expect, test } from 'bun:test';
import {
    completePendingSubscriptionPaymentOrderTx,
    completePendingTopupPaymentOrderTx,
} from './paymentCallback';

function txWithReturning(rows: Array<Record<string, unknown>>) {
    return {
        update: () => ({
            set: () => ({
                where: () => ({
                    returning: async () => rows,
                }),
            }),
        }),
    };
}

describe('payment callback idempotency helpers', () => {
    test('fulfills a pending top-up order exactly once', async () => {
        const fulfilled: Array<Record<string, unknown>> = [];
        const order = { id: 1, amount: 500, userId: 9, paymentMethod: 'stripe' };

        const result = await completePendingTopupPaymentOrderTx(
            txWithReturning([order]),
            1,
            'txn_1',
            async (_tx, pendingOrder) => {
                fulfilled.push(pendingOrder);
            },
        );

        expect(result).toEqual(order);
        expect(fulfilled).toEqual([order]);
    });

    test('does not fulfill already-completed top-up orders', async () => {
        const fulfilled: Array<Record<string, unknown>> = [];

        const result = await completePendingTopupPaymentOrderTx(
            txWithReturning([]),
            1,
            'txn_1',
            async (_tx, pendingOrder) => {
                fulfilled.push(pendingOrder);
            },
        );

        expect(result).toBeNull();
        expect(fulfilled).toEqual([]);
    });

    test('requires a subscription order selector', async () => {
        await expect(completePendingSubscriptionPaymentOrderTx(
            txWithReturning([]),
            {},
            'stripe',
            'txn_sub',
            {},
            async () => undefined,
        )).rejects.toThrow('Missing subscription order selector');
    });
});
