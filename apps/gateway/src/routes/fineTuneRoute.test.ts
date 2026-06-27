import { describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {},
}));

const { serializeLegacyFineTune } = await import('./fine-tune');

describe('Legacy fine-tune route compatibility', () => {
    test('serializes PostgreSQL fine_tuning job rows to legacy fine-tune shape', () => {
        const result = serializeLegacyFineTune({
            id: 'ftjob_1',
            createdAt: new Date('2026-06-27T00:00:00.000Z'),
            updatedAt: new Date('2026-06-27T00:01:00.000Z'),
            model: 'gpt-4o',
            fineTunedModel: 'ft:gpt-4o:elygate:test',
            organizationId: 'org_1',
            status: 'succeeded',
            trainingFileId: 'file_train',
            validationFileId: 'file_valid',
            resultFiles: ['file_result'],
            hyperparameters: { n_epochs: 1 },
        });

        expect(result).toMatchObject({
            id: 'ftjob_1',
            object: 'fine-tune',
            created_at: 1782518400,
            updated_at: 1782518460,
            model: 'gpt-4o',
            fine_tuned_model: 'ft:gpt-4o:elygate:test',
            organization_id: 'org_1',
            status: 'succeeded',
            training_files: [{ id: 'file_train', object: 'file' }],
            validation_files: [{ id: 'file_valid', object: 'file' }],
            result_files: ['file_result'],
            hyperparams: { n_epochs: 1 },
            events: [],
        });
    });
});
