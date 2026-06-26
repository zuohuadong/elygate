import { config, isProduction } from '../config';

export type EnterpriseRuntimeConfig = {
    readonly enabled: boolean;
    readonly appId: string;
    readonly appInstanceId: string;
    readonly tenantId: string;
    readonly orgId: string;
    readonly projectId?: string;
    readonly supauthIssuerUrl: string;
    readonly supauthJwksUrl: string;
    readonly supauthAudience: string;
    readonly publicBaseUrl: string;
    readonly adminBaseUrl: string;
    readonly allowUnverifiedDevTokens: boolean;
};

export const enterpriseRuntimeConfig: EnterpriseRuntimeConfig = {
    enabled: process.env.ELYGATE_LAYER === 'enterprise' || Boolean(process.env.SUPAUTH_ISSUER_URL || process.env.SUPAUTH_JWKS_URL),
    appId: process.env.ELYGATE_APP_ID || 'elygate-ai-gateway',
    appInstanceId: process.env.ELYGATE_APP_INSTANCE_ID || '',
    tenantId: process.env.ELYGATE_TENANT_ID || '',
    orgId: process.env.ELYGATE_ORG_ID || '',
    projectId: process.env.ELYGATE_PROJECT_ID || undefined,
    supauthIssuerUrl: process.env.SUPAUTH_ISSUER_URL || '',
    supauthJwksUrl: process.env.SUPAUTH_JWKS_URL || '',
    supauthAudience: process.env.SUPAUTH_AUDIENCE || config.gatewayUrl,
    publicBaseUrl: process.env.ELYGATE_PUBLIC_BASE_URL || config.gatewayUrl,
    adminBaseUrl: process.env.ELYGATE_ADMIN_BASE_URL || config.gatewayUrl,
    allowUnverifiedDevTokens: !isProduction && process.env.ENTERPRISE_AUTH_MODE !== 'strict' && !process.env.SUPAUTH_JWKS_URL,
};

export function enterpriseConfigured(): boolean {
    return enterpriseRuntimeConfig.enabled
        && Boolean(enterpriseRuntimeConfig.supauthAudience)
        && (enterpriseRuntimeConfig.allowUnverifiedDevTokens || Boolean(enterpriseRuntimeConfig.supauthJwksUrl));
}
