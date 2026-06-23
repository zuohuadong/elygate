import { AI_GATEWAY_SCOPES } from '@elygate/enterprise-contracts';
import { authorizeBearer, createSupAuthJwtVerifier, parseBearerToken } from '@elygate/enterprise-authz';
import type { AiGatewayScope, PlatformClaims } from '@elygate/enterprise-contracts';
import type { EnterpriseAuthFailureCode } from '@elygate/enterprise-authz';
import { enterpriseRuntimeConfig } from './config';

export type EnterpriseAuthContext = {
    readonly claims: PlatformClaims;
};

const verifier = createSupAuthJwtVerifier({
    issuer: enterpriseRuntimeConfig.supauthIssuerUrl || undefined,
    audience: enterpriseRuntimeConfig.supauthAudience,
    jwksUrl: enterpriseRuntimeConfig.supauthJwksUrl || undefined,
    allowUnverifiedDevTokens: enterpriseRuntimeConfig.allowUnverifiedDevTokens,
});

function statusForFailure(code: EnterpriseAuthFailureCode): number {
    if (code === 'insufficient_scope') return 403;
    return 401;
}

export function classifyEnterpriseAuthorization(authorizationHeader: string | null): 'missing' | 'gateway-api-key' | 'supauth-token' {
    const token = parseBearerToken(authorizationHeader);
    if (!token) return 'missing';
    return token.startsWith('sk-') ? 'gateway-api-key' : 'supauth-token';
}

export async function requireEnterpriseClaims(
    authorizationHeader: string | null,
    requiredScopes: readonly AiGatewayScope[] = [AI_GATEWAY_SCOPES.gatewayRead],
): Promise<EnterpriseAuthContext> {
    const kind = classifyEnterpriseAuthorization(authorizationHeader);
    if (kind === 'gateway-api-key') {
        throw Object.assign(new Error('Gateway API keys are only valid for AI data-plane requests, not enterprise control-plane APIs'), {
            statusCode: 401,
        });
    }

    const result = await authorizeBearer(authorizationHeader, {
        verifyToken: verifier,
        requiredScopes,
    });

    if (!result.ok) {
        throw Object.assign(new Error(result.message), { statusCode: statusForFailure(result.code) });
    }

    return { claims: result.claims };
}
