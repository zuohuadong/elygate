import type { ElysiaCtx } from '../types';
import { Elysia, t } from 'elysia';
import { db, sql } from '@elygate/db';
import { workflowTemplates } from '@elygate/db/schema';
import { eq, or, isNull, desc, sql as drizzleSql } from 'drizzle-orm';
import { authPlugin } from '../middleware/auth';
import { dispatch } from '../services/dispatcher';
import { ChannelType } from '../providers/types';

export const workflowsRouter = new Elysia({ prefix: '/workflows' })
    .use(authPlugin)
    .post('/execute', async ({ body, user, token, set }: ElysiaCtx) => {
        const { template_id, parameters, model } = body;

        if (!template_id) {
            set.status = 400;
            return { success: false, error: "template_id is required" };
        }

        const [template] = await db.select({
            id: workflowTemplates.id,
            templateJson: workflowTemplates.templateJson,
            inputParameters: workflowTemplates.inputParameters,
            providerType: workflowTemplates.providerType,
        })
        .from(workflowTemplates)
        .where(eq(workflowTemplates.id, template_id));

        if (!template) {
            set.status = 404;
            return { success: false, error: "Template not found" };
        }

        let workflowString = JSON.stringify(template.templateJson);
        const params = parameters || {};
        
        for (const [key, value] of Object.entries(params)) {
            const placeholder = `{{${key}}}`;
            workflowString = workflowString.replaceAll(placeholder, String(value));
        }

        const resolvedWorkflow = JSON.parse(workflowString);

        return await dispatch({
            model: model || 'comfyui-default',
            body: { 
                ...body, 
                workflow: resolvedWorkflow,
                template_id: template.id
            },
            user,
            token,
            endpointType: 'images',
            skipTransform: false,
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
            idempotency_key: t.Optional(t.String()),
            external_task_id: t.Optional(t.String()),
            external_user_id: t.Optional(t.String()),
            external_workspace_id: t.Optional(t.String()),
            external_feature_type: t.Optional(t.String())
        })
    })
    .get('/templates', async () => {
        const templates = await db.select({
            id: workflowTemplates.id,
            name: workflowTemplates.name,
            description: workflowTemplates.description,
            groupName: workflowTemplates.groupName,
            inputParameters: workflowTemplates.inputParameters,
            createdAt: workflowTemplates.createdAt,
        })
        .from(workflowTemplates)
        .where(or(eq(workflowTemplates.isPublic, true), isNull(workflowTemplates.userId)))
        .orderBy(desc(workflowTemplates.createdAt));
        return { success: true, data: templates };
    });
