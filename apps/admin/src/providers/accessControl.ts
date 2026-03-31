import { getAuthProvider } from '@svadmin/core';
import type { AccessControlProvider } from '@svadmin/core';

/**
 * Role-based access control for Elygate:
 * - role === 10: Admin — full access to all resources
 * - role === 1:  Consumer — access to consumer-facing resources only
 */
export function createRoleBasedAccessControl(): AccessControlProvider {
  return {
    can: async (params) => {
      const authProvider = getAuthProvider();
      if (!authProvider?.getIdentity) {
        return Array.isArray(params) ? params.map(() => ({ can: true })) : { can: true };
      }

      let role: number | undefined;
      try {
        const identity = await authProvider.getIdentity();
        role = (identity as Record<string, unknown>)?.role as number | undefined;
      } catch {
        return Array.isArray(params) ? params.map(() => ({ can: false, reason: '权限校验失败' })) : { can: false, reason: '权限校验失败' };
      }

      const checkSingle = ({ resource, action }: { resource?: string, action?: string }) => {
        if (!resource) return { can: true };

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
      };

      if (Array.isArray(params)) {
        return params.map(checkSingle);
      }
      return checkSingle(params);
    },

    options: {
      buttons: {
        enableAccessControl: true,
        hideIfUnauthorized: true,
      },
    },
  };
}
