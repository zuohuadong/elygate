/**
 * CASL adapter for svadmin AccessControlProvider.
 *
 * Converts a CASL `Ability` instance into an `AccessControlProvider`.
 *
 * @example
 * ```ts
 * import { AbilityBuilder, createMongoAbility } from '@casl/ability';
 * import { createCaslAccessControl } from '@svadmin/core/adapters/casl';
 * import { setAccessControlProvider } from '@svadmin/core';
 *
 * const { can, build } = new AbilityBuilder(createMongoAbility);
 * can('read', 'Post');
 * can('create', 'Post');
 * can('manage', 'User');
 * const ability = build();
 *
 * setAccessControlProvider(createCaslAccessControl(ability));
 * ```
 */

import type { AccessControlProvider, CanParams, CanResult } from '../permissions';

/** CASL Ability interface (minimal, to avoid hard dependency on @casl/ability) */
interface CaslAbility {
  can: (action: string, subject: string, field?: string) => boolean;
  cannot: (action: string, subject: string, field?: string) => boolean;
}

/**
 * Create an AccessControlProvider from a CASL Ability.
 *
 * @param ability - A CASL Ability instance
 * @param options - Optional configuration
 */
export function createCaslAccessControl(
  ability: CaslAbility,
  options?: AccessControlProvider['options'],
): AccessControlProvider {
  return {
    can: async ({ resource, action, params }: CanParams): Promise<CanResult> => {
      const field = params?.field as string | undefined;
      const allowed = ability.can(action, resource, field);
      return {
        can: allowed,
        reason: allowed ? undefined : `Cannot "${action}" on "${resource}"${field ? ` (field: ${field})` : ''}`,
      };
    },
    options,
  };
}
