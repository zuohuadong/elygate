export interface EmployeeIdentity {
  readonly providerId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
}

export interface EmployeeVirtualKey {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isActive: boolean;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly maskedValue: string;
}

export interface EmployeeUsage {
  readonly period: string;
  readonly keyIds: readonly string[];
  readonly dashboard: unknown;
}

export interface AuthProviderSummary {
  readonly id: string;
  readonly name: string;
}
