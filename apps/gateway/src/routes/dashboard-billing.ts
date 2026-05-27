import type { ElysiaCtx, TokenRecord, UserRecord } from '../types';
import { Elysia } from 'elysia';
import { authPlugin } from '../middleware/auth';
import { optionCache } from '../services/optionCache';

function quotaToDisplayAmount(quota: number): number {
    const quotaPerUnit = Number(optionCache.get('QuotaPerUnit', 500000));
    const exchangeRate = Number(optionCache.get('ExchangeRate', 7.2));
    const displayType = String(optionCache.get('QuotaDisplayType', 'USD')).toUpperCase();
    if (displayType === 'CNY' || displayType === 'RMB') return quota / quotaPerUnit * exchangeRate;
    if (displayType === 'TOKENS') return quota;
    return quota / quotaPerUnit;
}

function getBillingQuota(user: UserRecord, token?: TokenRecord) {
    if (token && token.id > 0) {
        const remainQuota = Number(token.remainQuota || 0);
        const usedQuota = Number(token.usedQuota || 0);
        return {
            total: token.unlimitedQuota ? 100000000 : remainQuota + usedQuota,
            used: usedQuota,
            accessUntil: token.expiredAt ? Math.floor(new Date(token.expiredAt).getTime() / 1000) : 0,
        };
    }
    return {
        total: Number(user.quota || 0) + Number(user.usedQuota || 0),
        used: Number(user.usedQuota || 0),
        accessUntil: 0,
    };
}

function subscriptionResponse({ user, token }: ElysiaCtx) {
    const billing = getBillingQuota(user as UserRecord, token as TokenRecord | undefined);
    const amount = quotaToDisplayAmount(billing.total);
    return {
        object: 'billing_subscription',
        has_payment_method: true,
        soft_limit_usd: amount,
        hard_limit_usd: amount,
        system_hard_limit_usd: amount,
        access_until: billing.accessUntil,
    };
}

function usageResponse({ user, token }: ElysiaCtx) {
    const billing = getBillingQuota(user as UserRecord, token as TokenRecord | undefined);
    return {
        object: 'list',
        total_usage: quotaToDisplayAmount(billing.used) * 100,
    };
}

export const dashboardBillingRouter = new Elysia()
    .use(authPlugin)
    .get('/dashboard/billing/subscription', subscriptionResponse)
    .get('/v1/dashboard/billing/subscription', subscriptionResponse)
    .get('/dashboard/billing/usage', usageResponse)
    .get('/v1/dashboard/billing/usage', usageResponse);
