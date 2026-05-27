import { paymentOrders, subscriptionOrders } from '@elygate/db/schema';
import { and, eq } from 'drizzle-orm';

export type TopupOrderForFulfillment = {
    id: number;
    amount: number;
    userId: number;
    paymentMethod: string;
};

export type SubscriptionOrderForFulfillment = {
    id: number;
    userId: number;
    packageId: number;
    paymentMethod: string;
    paymentProvider: string;
    amount: number;
    money: string | number;
};

export async function completePendingTopupPaymentOrderTx(
    tx: any,
    orderId: number,
    transactionId: string | null | undefined,
    fulfill: (tx: any, order: TopupOrderForFulfillment) => Promise<void>,
) {
    const [order] = await tx.update(paymentOrders)
        .set({ status: 1, transactionId: transactionId ?? null, updatedAt: new Date() })
        .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.status, 0)))
        .returning({
            id: paymentOrders.id,
            amount: paymentOrders.amount,
            userId: paymentOrders.userId,
            paymentMethod: paymentOrders.paymentMethod,
        });

    if (!order) return null;
    await fulfill(tx, order);
    return order;
}

export async function completePendingSubscriptionPaymentOrderTx(
    tx: any,
    selector: { orderId?: number; tradeNo?: string },
    paymentProvider: string,
    transactionId: string | null | undefined,
    providerPayload: unknown,
    fulfill: (tx: any, order: SubscriptionOrderForFulfillment) => Promise<void>,
) {
    const selectorFilter = selector.orderId
        ? eq(subscriptionOrders.id, selector.orderId)
        : selector.tradeNo
            ? eq(subscriptionOrders.tradeNo, selector.tradeNo)
            : null;
    if (!selectorFilter) throw new Error('Missing subscription order selector');

    const [order] = await tx.update(subscriptionOrders)
        .set({
            status: 'success',
            paymentProvider,
            transactionId: transactionId ?? null,
            providerPayload: JSON.stringify(providerPayload || {}),
            completedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(and(selectorFilter, eq(subscriptionOrders.status, 'pending')))
        .returning({
            id: subscriptionOrders.id,
            userId: subscriptionOrders.userId,
            packageId: subscriptionOrders.packageId,
            paymentMethod: subscriptionOrders.paymentMethod,
            paymentProvider: subscriptionOrders.paymentProvider,
            amount: subscriptionOrders.amount,
            money: subscriptionOrders.money,
        });

    if (!order) return null;
    await fulfill(tx, order);
    return order;
}
