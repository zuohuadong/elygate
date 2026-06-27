export const PUBLIC_RECHARGE_COMPLIANCE_DECISION = 'disabled-by-default';

export function isPublicRechargeEnabled(optionValue: unknown): boolean {
    return String(optionValue ?? '').trim().toLowerCase() === 'true';
}

export function assertPublicRechargeEnabled(optionValue: unknown): void {
    if (!isPublicRechargeEnabled(optionValue)) {
        throw new Error('Self-recharge is currently disabled');
    }
}
