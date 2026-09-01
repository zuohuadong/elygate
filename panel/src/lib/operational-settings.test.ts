import { describe, expect, test } from 'bun:test';
import { buildUserAgentPayload, logoDataUrl, userAgentDraftFromRecord } from './operational-settings';

describe('operational settings helpers', () => {
	test('round-trips a validated user-agent mapping', () => {
		const draft = userAgentDraftFromRecord({
			pattern: '^Codex/', match_type: 'regex', app: 'Codex', logo: 'aGVsbG8=', logo_mime: 'image/png', is_active: false,
		});
		expect(buildUserAgentPayload(draft)).toEqual({
			pattern: '^Codex/', match_type: 'regex', app: 'Codex', logo: 'aGVsbG8=', logo_mime: 'image/png', is_active: false,
		});
	});

	test('rejects invalid regular expressions and active image types', () => {
		const draft = userAgentDraftFromRecord({ pattern: '[', match_type: 'regex', app: 'Bad' });
		expect(() => buildUserAgentPayload(draft)).toThrow('regex-invalid');
		draft.pattern = 'ok'; draft.logo = 'PHN2Zz4='; draft.logoMime = 'image/svg+xml';
		expect(() => buildUserAgentPayload(draft)).toThrow('logo-type');
	});

	test('only renders allowlisted raster logo data URLs', () => {
		expect(logoDataUrl({ logo: 'aGVsbG8=', logo_mime: 'image/webp' })).toBe('data:image/webp;base64,aGVsbG8=');
		expect(logoDataUrl({ logo: 'PHN2Zz4=', logo_mime: 'image/svg+xml' })).toBe('');
	});
});
