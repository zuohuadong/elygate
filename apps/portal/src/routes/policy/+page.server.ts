import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

type PolicyRow = {
    allowed_models: string[] | null;
    denied_models: string[] | null;
    allowed_subnets: string | null;
    quota_alarm_threshold: number | string | null;
};

export const load: PageServerLoad = async ({ parent }) => {
    const { org } = await parent();
    
    const [policy] = await sql`
        SELECT allowed_models, denied_models, allowed_subnets, quota_alarm_threshold
        FROM organizations
        WHERE id = ${org.id}
    ` as PolicyRow[];

    return {
        policy: {
            allowedModels: policy?.allowed_models ?? [],
            deniedModels: policy?.denied_models ?? [],
            allowedSubnets: policy?.allowed_subnets ?? '',
            quotaAlarmThreshold: Number(policy?.quota_alarm_threshold ?? 80)
        }
    };
};
