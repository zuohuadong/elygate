import { describe, expect, test } from 'bun:test';
import { ChannelType } from '../providers/types';
import { extractResponseInputText, serializeBatch, serializeFile } from './protocolShapes';
import { buildUpstreamProtocolUrl } from '../utils/url';

describe('OpenAI-compatible protocol golden helpers', () => {
    test('extracts Responses input text from supported OpenAI shapes', () => {
        expect(extractResponseInputText('  hello world  ')).toBe('hello world');
        expect(extractResponseInputText([
            'first',
            { role: 'user', content: 'second' },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'third' },
                    { type: 'input_image', image_url: 'https://example.test/a.png' },
                    { type: 'output_text', text: 'fourth' },
                ],
            },
        ])).toBe('first\nsecond\nthird\nfourth');
        expect(extractResponseInputText([{ role: 'user', content: [{ type: 'input_image' }] }])).toBe('');
    });

    test('serializes Files rows to OpenAI-compatible file objects', () => {
        const file = serializeFile({
            id: 'file_abc',
            object: 'file',
            bytes: '42',
            createdAt: new Date('2026-06-27T00:00:00.000Z'),
            filename: 'batch.jsonl',
            purpose: 'batch',
            status: 'processed',
        });

        expect(file).toEqual({
            id: 'file_abc',
            object: 'file',
            bytes: 42,
            created_at: 1782518400,
            filename: 'batch.jsonl',
            purpose: 'batch',
            status: 'processed',
            status_details: null,
        });
    });

    test('serializes Batch rows with snake_case timestamps and defaults', () => {
        const batch = serializeBatch({
            id: 'batch_abc',
            object: 'batch',
            endpoint: '/v1/chat/completions',
            input_file_id: 'file_abc',
            status: 'validating',
            created_at: '2026-06-27T00:00:00.000Z',
            in_progress_at: null,
        });

        expect(batch).toMatchObject({
            id: 'batch_abc',
            object: 'batch',
            endpoint: '/v1/chat/completions',
            input_file_id: 'file_abc',
            completion_window: '24h',
            status: 'validating',
            output_file_id: null,
            error_file_id: null,
            created_at: 1782518400,
            in_progress_at: null,
            request_counts: { total: 0, completed: 0, failed: 0 },
            metadata: {},
            errors: null,
        });
    });

    test('builds explicit compact upstream paths without losing the v1 prefix', () => {
        const channel = { baseUrl: 'https://upstream.example/v1', type: ChannelType.OPENAI };

        expect(buildUpstreamProtocolUrl(channel as any, '/responses/compact')).toBe('https://upstream.example/v1/responses/compact');
        expect(buildUpstreamProtocolUrl(channel as any, '/responses/resp_123/compact')).toBe('https://upstream.example/v1/responses/resp_123/compact');
    });
});
