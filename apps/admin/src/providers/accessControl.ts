import { getAuthProvider } from '@svadmin/core';
import type { AccessControlProvider } from '@svadmin/core';

/**
 * Role-based access control for Elygate:
 * - role === 10: Admin — full access to all resources
 * - role === 1:  Consumer — access to consumer-facing resources only
 */
export function createRoleBasedAccessControl(): AccessControlProvider {
  return {
    can: async ({ resource, action }) => {
      if (!resource) return { can: true };

      const authProvider = getAuthProvider();
      if (!authProvider?.getIdentity) return { can: true };

      try {
        const identity = await authProvider.getIdentity();
        const role = (identity as Record<string, unknown>)?.role;

        // Super Admin — full access
        if (role === 10) return { can: true };

        // Regular user — restricted to consumer resources
        if (role === 1) {
          const consumerResources = [
            'tokens',  // User can manage their own API keys
          ];
          if (consumerResources.includes(resource)) {
            return { can: true };
          }
          return { can: false, reason: '权限不足' };
        }

        return { can: false, reason: '未授权' };
      } catch {
        return { can: false, reason: '权限校验失败' };
      }
    },
    options: {
      buttons: {
        enableAccessControl: true,
        hideIfUnauthorized: true,
      },
    },
  };
}
