import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import { dispatch } from '../services/dispatcher';
import { ChannelType  } from '../providers/types';

export const workflowsRouter = new Elysia({ prefix: '/v1/workflows' })
    .use(authPlugin)
    .post('/execute', async ({ body, user, token, set }: any) => {
        const { template_id, parameters, model } = body;

        if (!template_id) {
            set.status = 400;
            return { success: false, error: "template_id is required" };
        }

        // 1. Fetch template from DB
        const [template] = await sql`
            SELECT id, template_json, input_parameters, provider_type
            FROM workflow_templates
            WHERE id = ${template_id}
        `;

        if (!template) {
            set.status = 404;
            return { success: false, error: "Template not found" };
        }

        // 2. Inject parameters into template_json
        // For simplicity, we assume template_json has strings like {{param_name}} 
        // OR we use the input_parameters mapping to target specific JSON paths.
        let workflowString = JSON.stringify(template.template_json);
        const params = parameters || {};
        
        for (const [key, value] of Object.entries(params)) {
            // Simple string replacement for now
            const placeholder = `{{${key}}}`;
            workflowString = workflowString.replaceAll(placeholder, String(value));
        }

        const resolvedWorkflow = JSON.parse(workflowString);

        // 3. Dispatch via dispatch
        // We override the body with the resolved workflow
        return await dispatch({
            model: model || 'comfyui-default',
            body: { 
                ...body, 
                workflow: resolvedWorkflow,
                template_id: template.id // Keep reference
            },
            user,
            token,
            endpointType: 'images', // ComfyUI is primarily image-based for now
            skipTransform: false,
            // Pass through metadata from previous phase
            idempotencyKey: body.idempotency_key,
            externalTaskId: body.external_task_id,
            externalUserId: body.external_user_id,
            externalWorkspaceId: body.external_workspace_id,
            externalFeatureType: body.external_feature_type || 'comfyui_workflow'
        });
    }, {
        body: t.Object({
            template_id: t.String(),
            parameters: t.Optional(t.Record(t.String(), t.Any())),
            model: t.Optional(t.String()),
            // Standard metadata fields
            idempotency_key: t.Optional(t.String()),
            external_task_id: t.Optional(t.String()),
            external_user_id: t.Optional(t.String()),
            external_workspace_id: t.Optional(t.String()),
            external_feature_type: t.Optional(t.String())
        })
    })
    .get('/templates', async () => {
        const templates = await sql`
            SELECT id, name, description, group_name, input_parameters, created_at
            FROM workflow_templates
            WHERE is_public = true OR user_id IS NULL
            ORDER BY created_at DESC
        `;
        return { success: true, data: templates };
    });
