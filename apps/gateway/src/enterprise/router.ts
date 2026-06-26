import { ELYGATE_ENTERPRISE_MANIFEST, AI_GATEWAY_SCOPES } from '@elygate/enterprise-contracts';
import type { PlatformEvent } from '@elygate/enterprise-contracts';
import { Elysia } from 'elysia';
import { enterpriseConfigured, enterpriseRuntimeConfig } from './config';
import { requireEnterpriseClaims } from './auth';
import { postgresEnterpriseControlPlane, requestMetaFromHeaders } from './controlPlane';
import type { EnterpriseControlPlane } from './controlPlane';

function ok<T>(data: T) {
    return { success: true, data };
}

function errorResponse(set: { status?: number | string }, error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 400;
    set.status = statusCode;
    return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
    };
}

function requestId(headers: Headers): string {
    return headers.get('x-request-id') || crypto.randomUUID();
}

export function createEnterpriseRouter(controlPlane: EnterpriseControlPlane = postgresEnterpriseControlPlane) {
    return new Elysia()
    .get('/manifest', () => ok(ELYGATE_ENTERPRISE_MANIFEST))
    .get('/health', ({ request }) => ok({
        app_id: enterpriseRuntimeConfig.appId,
        app_instance_id: enterpriseRuntimeConfig.appInstanceId || null,
        tenant_id: enterpriseRuntimeConfig.tenantId || null,
        org_id: enterpriseRuntimeConfig.orgId || null,
        project_id: enterpriseRuntimeConfig.projectId || null,
        enabled: enterpriseRuntimeConfig.enabled,
        configured: enterpriseConfigured(),
        supauth: {
            issuer_configured: Boolean(enterpriseRuntimeConfig.supauthIssuerUrl),
            jwks_configured: Boolean(enterpriseRuntimeConfig.supauthJwksUrl),
            audience: enterpriseRuntimeConfig.supauthAudience,
            dev_unverified_tokens: enterpriseRuntimeConfig.allowUnverifiedDevTokens,
        },
        request_id: requestId(request.headers),
    }))
    .get('/me', async ({ request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'));
            return ok({ claims });
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/overview', async ({ request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayRead]);
            return ok(await controlPlane.getEnterpriseOverview(claims));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/gateway-instances', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayRead]);
            return ok(await controlPlane.listGatewayInstances(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/gateway-instances', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayAdmin]);
            return ok(await controlPlane.installEnterpriseGateway(body, claims, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .put('/gateway-instances/:id', async ({ params, body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayAdmin]);
            return ok(await controlPlane.updateGatewayInstance(claims, params.id, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/identity-and-policy', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.getIdentityAndPolicy(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/identity-policies', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.listIdentityPolicies(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/identity-policies', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.createIdentityPolicy(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .put('/identity-policies/:id', async ({ params, body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.updateIdentityPolicy(claims, params.id, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/policy-evaluations', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.evaluateEnterprisePolicy(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/usage-and-budget', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.usageRead]);
            return ok(await controlPlane.getUsageAndBudget(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/usage-attribution', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.usageRead]);
            return ok(await controlPlane.listUsageAttribution(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/budgets', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.usageRead]);
            return ok(await controlPlane.listBudgets(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/budgets', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.createBudget(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .put('/budgets/:id', async ({ params, body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.updateBudget(claims, params.id, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/budget-evaluations', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.evaluateEnterpriseBudget(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/members-and-access', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.getMembersAndAccess(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/memberships', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.listMemberships(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/memberships', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.upsertMembership(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .put('/memberships/:id', async ({ params, body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.updateMembership(claims, params.id, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/org-entitlements', async ({ request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayRead]);
            return ok(await controlPlane.getOrgEntitlements(claims));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .put('/org-entitlements', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.updateOrgEntitlements(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/usage-efficiency', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.usageRead]);
            return ok(await controlPlane.getUsageEfficiency(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/billing-and-invoices', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.usageRead]);
            return ok(await controlPlane.getBillingAndInvoices(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/invoices', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.usageRead]);
            return ok(await controlPlane.listInvoices(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/billing-account', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayAdmin]);
            return ok(await controlPlane.upsertBillingAccount(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/invoices', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayAdmin]);
            return ok(await controlPlane.createInvoice(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/data-governance', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.getDataGovernance(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/provider-compliance', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            return ok(await controlPlane.upsertProviderCompliance(claims, body, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/audit-events/export', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.auditRead]);
            return ok(await controlPlane.exportAuditEvents(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/audit-events', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.auditRead]);
            return ok(await controlPlane.listAuditEvents(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/provider-channels', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.channelManage]);
            return ok(await controlPlane.listProviderChannels(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/model-routes', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayRead]);
            return ok(await controlPlane.listModelRoutes(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/gateway-api-keys', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.keyManage]);
            return ok(await controlPlane.listGatewayApiKeys(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/request-logs', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.usageRead]);
            return ok(await controlPlane.listRequestLogs(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .get('/agent-memories', async ({ query, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.memoryManage]);
            return ok(await controlPlane.listAgentMemories(claims, query));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/install', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayAdmin]);
            return ok(await controlPlane.installEnterpriseGateway(body, claims, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/uninstall', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.gatewayAdmin]);
            return ok(await controlPlane.uninstallEnterpriseGateway(body, claims, requestMetaFromHeaders(request.headers)));
        } catch (error) {
            return errorResponse(set, error);
        }
    })
    .post('/events', async ({ body, request, set }) => {
        try {
            const { claims } = await requireEnterpriseClaims(request.headers.get('authorization'), [AI_GATEWAY_SCOPES.policyManage]);
            const action = await controlPlane.applyPlatformEvent(body as PlatformEvent, claims, requestMetaFromHeaders(request.headers));
            return ok({
                action,
                accepted_by: {
                    tenant_id: claims.tenant_id,
                    org_id: claims.org_id,
                    app_instance_id: claims.app_instance_id,
                    actor: claims.user_id || claims.service_account_id || claims.subject || null,
                },
            });
        } catch (error) {
            return errorResponse(set, error);
        }
    });
}

export const enterpriseRouter = createEnterpriseRouter();
