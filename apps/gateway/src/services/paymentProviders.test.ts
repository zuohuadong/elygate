import { describe, expect, test } from 'bun:test';
import { parseCreemWebhookEvent, verifyCreemWebhookSignature } from './creem';
import { parseWaffoWebhookEvent, verifyWaffoWebhookSignature } from './waffo';
import { generateEPaySign, verifyStripeWebhookSignature } from './paymentSignatures';
import { PUBLIC_RECHARGE_COMPLIANCE_DECISION, assertPublicRechargeEnabled, isPublicRechargeEnabled } from './paymentPolicy';

describe('payment provider webhook parsers', () => {
    test('verifies enabled provider webhook signatures with sandbox secrets', () => {
        const stripeBody = JSON.stringify({ type: 'checkout.session.completed' });
        const stripeTimestamp = '1782518400';
        const stripeSecret = 'whsec_sandbox';
        const stripeSig = new Bun.CryptoHasher('sha256', stripeSecret)
            .update(`${stripeTimestamp}.${stripeBody}`)
            .digest('hex');
        expect(verifyStripeWebhookSignature(stripeBody, `t=${stripeTimestamp},v1=${stripeSig}`, stripeSecret)).toBe(true);
        expect(verifyStripeWebhookSignature(stripeBody, `t=${stripeTimestamp},v1=bad`, stripeSecret)).toBe(false);

        const epayParams = new URLSearchParams([
            ['money', '12.50'],
            ['out_trade_no', 'ELY42'],
            ['pid', 'merchant_1'],
            ['trade_no', 'epay_txn'],
        ]);
        const sortedEpayParams = new URLSearchParams([...epayParams.entries()].sort()).toString();
        expect(generateEPaySign(sortedEpayParams, 'epay_sandbox_secret')).toBe(
            new Bun.CryptoHasher('md5').update(`${sortedEpayParams}epay_sandbox_secret`).digest('hex'),
        );

        const creemBody = JSON.stringify({ event_type: 'checkout.session.completed' });
        const creemSecret = 'creem_sandbox_secret';
        const creemSig = new Bun.CryptoHasher('sha256', creemSecret).update(creemBody).digest('hex');
        expect(verifyCreemWebhookSignature(creemBody, creemSig, creemSecret)).toBe(true);
        expect(verifyCreemWebhookSignature(creemBody, 'bad', creemSecret)).toBe(false);

        const waffoBody = JSON.stringify({ status: 'paid' });
        const waffoSecret = 'waffo_sandbox_secret';
        const waffoSig = new Bun.CryptoHasher('sha256', waffoSecret).update(waffoBody).digest('hex');
        expect(verifyWaffoWebhookSignature(waffoBody, waffoSig, waffoSecret)).toBe(true);
        expect(verifyWaffoWebhookSignature(waffoBody, 'bad', waffoSecret)).toBe(false);
    });

    test('keeps public recharge disabled unless compliance explicitly enables it', () => {
        expect(PUBLIC_RECHARGE_COMPLIANCE_DECISION).toBe('disabled-by-default');
        expect(isPublicRechargeEnabled(undefined)).toBe(false);
        expect(isPublicRechargeEnabled('false')).toBe(false);
        expect(isPublicRechargeEnabled('true')).toBe(true);
        expect(() => assertPublicRechargeEnabled(undefined)).toThrow('Self-recharge is currently disabled');
    });

    test('extracts Creem checkout metadata', () => {
        expect(parseCreemWebhookEvent({
            event_type: 'checkout.session.completed',
            object: {
                id: 'creem_txn',
                amount: 1999,
                metadata: { order_id: '42' },
            },
        })).toEqual({
            orderId: '42',
            eventType: 'checkout.session.completed',
            amount: 1999,
            transactionId: 'creem_txn',
        });
    });

    test('rejects Creem events without an order id', () => {
        expect(parseCreemWebhookEvent({ type: 'payment.completed', object: { metadata: {} } })).toBeNull();
    });

    test('extracts Waffo callback data from query or body aliases', () => {
        expect(parseWaffoWebhookEvent(
            { order_id: '88', amount: '12.50' },
            { status: 'paid', trade_no: 'waffo_txn' },
        )).toEqual({
            orderId: '88',
            status: 'paid',
            amount: 12.5,
            transactionId: 'waffo_txn',
        });
    });
});
