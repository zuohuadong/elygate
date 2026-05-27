type PackageLike = {
    id?: number;
    name?: string;
    subtitle?: string | null;
    price?: string | number;
    currency?: string | null;
    durationUnit?: string | null;
    durationValue?: number | null;
    customSeconds?: number | null;
    enabled?: boolean | null;
    sortOrder?: number | null;
    stripePriceId?: string | null;
    creemProductId?: string | null;
    waffoPancakeProductId?: string | null;
    maxPurchasePerUser?: number | null;
    upgradeGroup?: string | null;
    totalAmount?: number | null;
    quotaResetPeriod?: string | null;
    quotaResetCustomSeconds?: number | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
};

export type NewApiSubscriptionPlanInput = Record<string, any>;

function toTimestampSeconds(value: Date | string | null | undefined): number {
    if (!value) return 0;
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
}

export function normalizeBillingPreference(value: unknown): string {
    const preference = typeof value === 'string' ? value.trim() : '';
    switch (preference) {
        case 'subscription_first':
        case 'wallet_first':
        case 'subscription_only':
        case 'wallet_only':
            return preference;
        default:
            return 'subscription_first';
    }
}

export function resolveSubscriptionPlanId(payload: Record<string, any>): number {
    return Number(payload.plan_id ?? payload.planId ?? payload.package_id ?? payload.packageId ?? payload.id ?? 0);
}

export function packageToNewApiSubscriptionPlan(pkg: PackageLike) {
    return {
        id: pkg.id,
        title: pkg.name || '',
        subtitle: pkg.subtitle || '',
        price_amount: Number(pkg.price || 0),
        currency: pkg.currency || 'USD',
        duration_unit: pkg.durationUnit || 'day',
        duration_value: Number(pkg.durationValue || 1),
        custom_seconds: Number(pkg.customSeconds || 0),
        enabled: pkg.enabled !== false,
        sort_order: Number(pkg.sortOrder || 0),
        stripe_price_id: pkg.stripePriceId || '',
        creem_product_id: pkg.creemProductId || '',
        waffo_pancake_product_id: pkg.waffoPancakeProductId || '',
        max_purchase_per_user: Number(pkg.maxPurchasePerUser || 0),
        upgrade_group: pkg.upgradeGroup || '',
        total_amount: Number(pkg.totalAmount || 0),
        quota_reset_period: pkg.quotaResetPeriod || 'never',
        quota_reset_custom_seconds: Number(pkg.quotaResetCustomSeconds || 0),
        created_at: toTimestampSeconds(pkg.createdAt),
        updated_at: toTimestampSeconds(pkg.updatedAt),
    };
}

export function wrapNewApiSubscriptionPlan(pkg: PackageLike) {
    return { plan: packageToNewApiSubscriptionPlan(pkg) };
}

export function newApiPlanToPackageValues(input: NewApiSubscriptionPlanInput) {
    const plan = input.plan && typeof input.plan === 'object' ? input.plan as Record<string, any> : input;
    const durationUnit = plan.duration_unit ?? plan.durationUnit ?? 'month';
    const durationValue = Number(plan.duration_value ?? plan.durationValue ?? 1);
    return {
        name: String(plan.title ?? plan.name ?? '').trim(),
        subtitle: plan.subtitle ?? null,
        price: String(plan.price_amount ?? plan.price ?? 0),
        currency: String(plan.currency || 'USD').toUpperCase(),
        durationDays: durationUnit === 'day' ? Math.max(durationValue, 1) : Number(plan.duration_days ?? plan.durationDays ?? 30),
        durationUnit,
        durationValue: Math.max(durationValue, 1),
        customSeconds: Number(plan.custom_seconds ?? plan.customSeconds ?? 0),
        enabled: plan.enabled ?? true,
        isPublic: plan.is_public ?? plan.isPublic ?? true,
        sortOrder: Number(plan.sort_order ?? plan.sortOrder ?? 0),
        stripePriceId: plan.stripe_price_id ?? plan.stripePriceId ?? null,
        creemProductId: plan.creem_product_id ?? plan.creemProductId ?? null,
        waffoPancakeProductId: plan.waffo_pancake_product_id ?? plan.waffoPancakeProductId ?? null,
        maxPurchasePerUser: Number(plan.max_purchase_per_user ?? plan.maxPurchasePerUser ?? 0),
        upgradeGroup: plan.upgrade_group ?? plan.upgradeGroup ?? null,
        totalAmount: Number(plan.total_amount ?? plan.totalAmount ?? 0),
        quotaResetPeriod: plan.quota_reset_period ?? plan.quotaResetPeriod ?? 'never',
        quotaResetCustomSeconds: Number(plan.quota_reset_custom_seconds ?? plan.quotaResetCustomSeconds ?? 0),
    };
}
