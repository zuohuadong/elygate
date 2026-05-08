import { db } from '$lib/server/db';
import { requireOrgManager, requirePortalMember } from '$lib/server/portalAuth';
import { organizations } from '@elygate/db/schema';
import { eq, sql as drizzleSql } from '@elygate/db/operators';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requirePortalMember(locals);
    
    const [policy] = await db.select({
        allowedModels: organizations.allowedModels,
        deniedModels: organizations.deniedModels,
        allowedSubnets: organizations.allowedSubnets,
        alertThresholdPct: organizations.alertThresholdPct,
        alertWebhookUrl: organizations.alertWebhookUrl,
    })
    .from(organizations)
    .where(eq(organizations.id, org.id));

    const availableModels = await db.execute(drizzleSql`
        SELECT DISTINCT jsonb_array_elements_text(models) as model
        FROM channels
        ORDER BY model ASC
    `) as { model: string }[];

    return {
        policy: {
            allowedModels: policy?.allowedModels ?? [],
            deniedModels: policy?.deniedModels ?? [],
            allowedSubnets: policy?.allowedSubnets ?? '',
            alertThresholdPct: Number(policy?.alertThresholdPct ?? 80),
            alertWebhookUrl: policy?.alertWebhookUrl ?? ''
        },
        availableModels: availableModels.map((modelRow) => modelRow.model)
    };
};

export const actions = {
    updatePolicy: async ({ request, locals }: { request: Request; locals: App.Locals }) => {
        const { org } = requireOrgManager(locals);
        const formData = await request.formData();
        
        const allowedSubnets = formData.get('allowedSubnets') as string;
        const alertThresholdPct = parseInt(formData.get('alertThresholdPct') as string);
        const alertWebhookUrl = formData.get('alertWebhookUrl') as string;
        const allowedModels = JSON.parse(formData.get('allowedModels') as string);
        const deniedModels = JSON.parse(formData.get('deniedModels') as string);

        await db.update(organizations)
            .set({ 
                allowedSubnets,
                alertThresholdPct,
                alertWebhookUrl,
                allowedModels,
                deniedModels,
                updatedAt: new Date(),
            })
            .where(eq(organizations.id, org.id));

        return { success: true };
    }
};
