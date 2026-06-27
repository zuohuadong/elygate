import { Elysia } from 'elysia';
import type { ElysiaCtx } from '../types';
import { db } from '@elygate/db';
import { fineTuningJobs } from '@elygate/db/schema';
import { and, desc, eq } from 'drizzle-orm';

function createId(): string {
    return `ftjob_${crypto.randomUUID().replace(/-/g, '')}`;
}

function ts(value: unknown): number | null {
    if (!value) return null;
    return Math.floor(new Date(value as string).getTime() / 1000);
}

export function serializeLegacyFineTune(row: Record<string, any>) {
    return {
        id: row.id,
        object: 'fine-tune',
        created_at: ts(row.createdAt),
        updated_at: ts(row.updatedAt),
        model: row.model,
        fine_tuned_model: row.fineTunedModel || null,
        organization_id: row.organizationId || null,
        status: row.status,
        training_files: row.trainingFileId ? [{ id: row.trainingFileId, object: 'file' }] : [],
        validation_files: row.validationFileId ? [{ id: row.validationFileId, object: 'file' }] : [],
        result_files: row.resultFiles || [],
        hyperparams: row.hyperparameters || {},
        events: [],
    };
}

/**
 * Fine-tune compatibility routes.
 * These deprecated OpenAI routes are backed by the same PostgreSQL fine_tuning_jobs
 * state table as /fine_tuning/jobs, so clients do not receive a false 501.
 */
export const fineTuneRouter = new Elysia()
    .post('/fine-tunes', async ({ body, user, token }: ElysiaCtx) => {
        const payload = body || {};
        const id = createId();
        const [row] = await db.insert(fineTuningJobs).values({
            id,
            userId: user.id,
            tokenId: token?.id || null,
            model: payload.model || 'gpt-4o',
            trainingFileId: payload.training_file || null,
            validationFileId: payload.validation_file || null,
            hyperparameters: payload.hyperparameters || payload.hyperparams || {},
            suffix: payload.suffix || null,
            integrations: payload.integrations || [],
            status: 'validating_files',
        }).returning();
        return serializeLegacyFineTune(row!);
    })
    .get('/fine-tunes', async ({ user, query }: ElysiaCtx) => {
        const limit = Math.min(Number(query?.limit || 20), 100);
        const rows = await db.select().from(fineTuningJobs)
            .where(eq(fineTuningJobs.userId, user.id))
            .orderBy(desc(fineTuningJobs.createdAt))
            .limit(limit);
        return { object: 'list', data: rows.map(serializeLegacyFineTune) };
    })
    .get('/fine-tunes/:id', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(fineTuningJobs)
            .where(and(eq(fineTuningJobs.id, params.id), eq(fineTuningJobs.userId, user.id)))
            .limit(1);
        if (!row) {
            set.status = 404;
            return { error: { message: 'No fine-tune job found', type: 'not_found' } };
        }
        return serializeLegacyFineTune(row);
    })
    .post('/fine-tunes/:id/cancel', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.update(fineTuningJobs).set({
            status: 'cancelled',
            finishedAt: new Date(),
            updatedAt: new Date(),
        }).where(and(eq(fineTuningJobs.id, params.id), eq(fineTuningJobs.userId, user.id))).returning();
        if (!row) {
            set.status = 404;
            return { error: { message: 'No fine-tune job found', type: 'not_found' } };
        }
        return serializeLegacyFineTune(row);
    })
    .get('/fine-tunes/:id/events', async ({ params, user, set }: ElysiaCtx) => {
        const [row] = await db.select().from(fineTuningJobs)
            .where(and(eq(fineTuningJobs.id, params.id), eq(fineTuningJobs.userId, user.id)))
            .limit(1);
        if (!row) {
            set.status = 404;
            return { error: { message: 'No fine-tune job found', type: 'not_found' } };
        }
        return { object: 'list', data: [] };
    });
