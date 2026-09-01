import { describe, expect, test } from 'bun:test';
import {
    newApiPlanToPackageValues,
    normalizeBillingPreference,
    packageToNewApiSubscriptionPlan,
    resolveSubscriptionPlanId,
    wrapNewApiSubscriptionPlan,
} from '../src/services/newApiSubscriptionCompat';

describe('New API subscription compatibility adapter', () => {
    test('maps New API plan fields to Elygate package fields', () => {
        const values = newApiPlanToPackageValues({
            plan: {
                title: 'Pro',
                subtitle: 'Monthly plan',
                price_amount: 9.99,
                duration_unit: 'month',
                duration_value: 1,
                total_amount: 1000000,
                quota_reset_period: 'monthly',
                quota_reset_custom_seconds: 0,
                stripe_price_id: 'price_123',
                max_purchase_per_user: 2,
                upgrade_group: 'pro',
                enabled: false,
            }
        });

        expect(values.name).toBe('Pro');
        expect(values.subtitle).toBe('Monthly plan');
        expect(values.price).toBe('9.99');
        expect(values.durationUnit).toBe('month');
        expect(values.durationValue).toBe(1);
        expect(values.totalAmount).toBe(1000000);
        expect(values.quotaResetPeriod).toBe('monthly');
        expect(values.stripePriceId).toBe('price_123');
        expect(values.maxPurchasePerUser).toBe(2);
        expect(values.upgradeGroup).toBe('pro');
        expect(values.enabled).toBe(false);
    });

    test('maps Elygate package fields to New API plan DTO', () => {
        const plan = packageToNewApiSubscriptionPlan({
            id: 7,
            name: 'Team',
            subtitle: 'Seat plan',
            price: '25.50',
            currency: 'USD',
            durationUnit: 'year',
            durationValue: 1,
            customSeconds: 0,
            enabled: true,
            sortOrder: 10,
            totalAmount: 5000000,
            quotaResetPeriod: 'never',
            quotaResetCustomSeconds: 0,
            createdAt: new Date('2026-01-01T00:00:00Z'),
        });

        expect(plan.id).toBe(7);
        expect(plan.title).toBe('Team');
        expect(plan.price_amount).toBe(25.5);
        expect(plan.duration_unit).toBe('year');
        expect(plan.total_amount).toBe(5000000);
        expect(plan.created_at).toBe(1767225600);
        expect(wrapNewApiSubscriptionPlan({ id: 7, name: 'Team' })).toEqual({
            plan: expect.objectContaining({ id: 7, title: 'Team' })
        });
    });

    test('normalizes subscription preference and plan id aliases', () => {
        expect(normalizeBillingPreference('wallet_first')).toBe('wallet_first');
        expect(normalizeBillingPreference('bad-value')).toBe('subscription_first');
        expect(resolveSubscriptionPlanId({ plan_id: '12' })).toBe(12);
        expect(resolveSubscriptionPlanId({ packageId: 13 })).toBe(13);
    });
});
