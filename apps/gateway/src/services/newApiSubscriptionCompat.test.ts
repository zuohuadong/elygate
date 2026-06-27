import { describe, expect, test } from 'bun:test';
import {
    newApiPlanToPackageValues,
    normalizeBillingPreference,
    packageToNewApiSubscriptionPlan,
    resolveSubscriptionPlanId,
} from './newApiSubscriptionCompat';

describe('New API subscription compatibility mapping', () => {
    test('normalizes supported billing preferences with safe fallback', () => {
        expect(normalizeBillingPreference('wallet_only')).toBe('wallet_only');
        expect(normalizeBillingPreference('unknown')).toBe('subscription_first');
        expect(normalizeBillingPreference(null)).toBe('subscription_first');
    });

    test('resolves plan identifiers from New API aliases', () => {
        expect(resolveSubscriptionPlanId({ plan_id: 12 })).toBe(12);
        expect(resolveSubscriptionPlanId({ packageId: 13 })).toBe(13);
        expect(resolveSubscriptionPlanId({ id: 14 })).toBe(14);
    });

    test('serializes Elygate packages into New API subscription plan shape', () => {
        const plan = packageToNewApiSubscriptionPlan({
            id: 7,
            name: 'Pro',
            price: '19.99',
            currency: 'usd',
            durationUnit: 'month',
            durationValue: 1,
            stripePriceId: 'price_123',
            totalAmount: 1000,
            createdAt: '2026-06-27T00:00:00.000Z',
        });

        expect(plan).toMatchObject({
            id: 7,
            title: 'Pro',
            price_amount: 19.99,
            currency: 'usd',
            duration_unit: 'month',
            stripe_price_id: 'price_123',
            total_amount: 1000,
            created_at: 1782518400,
        });
    });

    test('maps New API plan payloads back to package values', () => {
        const values = newApiPlanToPackageValues({
            plan: {
                title: 'Team',
                price_amount: 99,
                currency: 'eur',
                duration_unit: 'day',
                duration_value: 7,
                stripe_price_id: 'price_team',
                creem_product_id: 'creem_team',
                quota_reset_custom_seconds: 3600,
            },
        });

        expect(values).toMatchObject({
            name: 'Team',
            price: '99',
            currency: 'EUR',
            durationDays: 7,
            durationUnit: 'day',
            durationValue: 7,
            stripePriceId: 'price_team',
            creemProductId: 'creem_team',
            quotaResetCustomSeconds: 3600,
        });
    });
});
