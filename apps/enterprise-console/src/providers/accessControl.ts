import type { AccessControlProvider, CanParams, CanResult } from '@svadmin/core';

const readOnlyResources = new Set(['audit-events']);

function checkOne(params: CanParams): CanResult {
  if (readOnlyResources.has(params.resource) && ['create', 'edit', 'delete'].includes(params.action)) {
    return { can: false, reason: '审计事件只允许读取' };
  }
  return { can: true };
}

export function createEnterpriseAccessControl(): AccessControlProvider {
  return {
    async can(params: CanParams | CanParams[]): Promise<CanResult | CanResult[]> {
      return Array.isArray(params) ? params.map(checkOne) : checkOne(params);
    },
  };
}
