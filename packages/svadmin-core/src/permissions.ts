// Permission / Access Control

// ─── Types ────────────────────────────────────────────────────

/** Actions that can be checked for access control. Extensible via string literal union. */
export type Action = 'list' | 'show' | 'create' | 'edit' | 'delete' | 'export' | 'field' | (string & {});

export interface CanParams {
  resource: string;
  action: Action;
  params?: { id?: string | number; [key: string]: unknown };
}

export interface CanResult {
  can: boolean;
  reason?: string;
}



/**
 * Formal Access Control Provider interface.
 * Implement this to define your authorization logic.
 *
 * @example
 * ```ts
 * const accessControlProvider: AccessControlProvider = {
 *   can: async ({ resource, action, params }) => {
 *     if (resource === 'users' && action === 'delete') {
 *       return { can: false, reason: 'Cannot delete users' };
 *     }
 *     return { can: true };
 *   },
 *   options: {
 *     buttons: { enableAccessControl: true, hideIfUnauthorized: false },
 *   },
 * };
 * ```
 */
export interface AccessControlProvider {
  can: (params: CanParams) => Promise<CanResult>;
  options?: {
    buttons?: {
      /** Enable access control checks on CRUD buttons globally. Default: false */
      enableAccessControl?: boolean;
      /** Hide buttons when unauthorized instead of disabling. Default: false */
      hideIfUnauthorized?: boolean;
    };
  };
}

// ─── State ────────────────────────────────────────────────────

let provider: AccessControlProvider | null = null;

// ─── API ──────────────────────────────────────────────────────

/**
 * Register an AccessControlProvider.
 */
export function setAccessControlProvider(p: AccessControlProvider): void {
  provider = p;
}

/** Get the current AccessControlProvider (or null) */
export function getAccessControlProvider(): AccessControlProvider | null {
  return provider;
}

/** Get global button options from the AccessControlProvider */
export function getAccessControlOptions() {
  return provider?.options ?? {};
}

/**
 * Synchronous access check. Returns `{ can: true }` if no provider is set.
 * When a provider is registered, this warns since provider.can() is always async.
 */
export function canAccess(resource: string, action: Action, params?: Record<string, unknown>): CanResult {
  if (!provider) return { can: true };
  console.warn('[permissions] canAccess called synchronously but provider.can() is async. Defaulting to { can: true }. Use canAccessAsync() instead.');
  return { can: true };
}

/**
 * Async access check. Preferred over `canAccess()`.
 */
export async function canAccessAsync(resource: string, action: Action, params?: Record<string, unknown>): Promise<CanResult> {
  if (!provider) return { can: true };
  return provider.can({ resource, action, params });
}
