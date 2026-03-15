import { sql } from '$lib/server/db';
import { requireOrgManager, requirePortalMember } from '$lib/server/portalAuth';
import type { PageServerLoad } from './$types';

type PolicyRow = {
    allowed_models: string[] | null;
    denied_models: string[] | null;
    allowed_subnets: string | null;
    alert_threshold_pct: number | null;
    alert_webhook_url: string | null;
};

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requirePortalMember(locals);
    
    const [policy] = await sql`
        SELECT allowed_models, denied_models, allowed_subnets, alert_threshold_pct, alert_webhook_url
        FROM organizations
        WHERE id = ${org.id}
    ` as PolicyRow[];

    // Fetch available models in the system for selection
    const availableModels = await sql`
        SELECT DISTINCT jsonb_array_elements_text(models) as model
        FROM channels
        ORDER BY model ASC
    ` as { model: string }[];

    return {
        policy: {
            allowedModels: policy?.allowed_models ?? [],
            deniedModels: policy?.denied_models ?? [],
            allowedSubnets: policy?.allowed_subnets ?? '',
            alertThresholdPct: Number(policy?.alert_threshold_pct ?? 80),
            alertWebhookUrl: policy?.alert_webhook_url ?? ''
        },
        availableModels: availableModels.map((modelRow) => modelRow.model)
    };
};

export const actions = {
    updatePolicy: async ({ request, locals }) => {
        const { org } = requireOrgManager(locals);
        const formData = await request.formData();
        
        const allowedSubnets = formData.get('allowedSubnets') as string;
        const alertThresholdPct = parseInt(formData.get('alertThresholdPct') as string);
        const alertWebhookUrl = formData.get('alertWebhookUrl') as string;
        const allowedModels = JSON.parse(formData.get('allowedModels') as string);
        const deniedModels = JSON.parse(formData.get('deniedModels') as string);

        await sql`
            UPDATE organizations
            SET 
                allowed_subnets = ${allowedSubnets},
                alert_threshold_pct = ${alertThresholdPct},
                alert_webhook_url = ${alertWebhookUrl},
                allowed_models = ${JSON.stringify(allowedModels)},
                denied_models = ${JSON.stringify(deniedModels)},
                updated_at = NOW()
            WHERE id = ${org.id}
        `;

        return { success: true };
    }
};
