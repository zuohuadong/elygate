import { describe, expect, test } from 'bun:test';
import { appendNotificationPage, isInternalNotificationPath, notificationActionHref, parseNotificationFeed, parseNotificationReadState, parseNotificationReadStates } from './notifications';

const notification = {
	id: '00000000-0000-4000-8000-000000000001',
	audience: 'admin' as const,
	severity: 'warning' as const,
	title: 'Budget reached',
	message: 'Project used 80% of its daily budget.',
	action_label: 'View budgets',
	action_path: '/#/control-plane-projects',
	created_at: '2026-10-27T08:00:00Z',
	expires_at: '2026-11-26T08:00:00Z',
};

describe('notification feed helpers', () => {
	test('accepts a valid admin feed and preserves the cursor', () => {
		expect(parseNotificationFeed({ notifications: [notification], next_cursor: 'cursor-1' })).toEqual({
			notifications: [notification],
			next_cursor: 'cursor-1',
		});
	});

	test('rejects malformed feed rows instead of rendering a false empty state', () => {
		for (const payload of [
			undefined,
			{},
			{ notifications: null },
			{ notifications: [{}] },
			{ notifications: [{ ...notification, severity: 'unknown' }] },
			{ notifications: [notification], next_cursor: 4 },
		]) {
			expect(() => parseNotificationFeed(payload)).toThrow('Invalid notification feed response');
		}
	});

	test('accepts empty pages with or without an opaque continuation cursor', () => {
		expect(parseNotificationFeed({ notifications: [] })).toEqual({ notifications: [] });
		expect(parseNotificationFeed({ notifications: [], next_cursor: '' })).toEqual({ notifications: [] });
		expect(parseNotificationFeed({ notifications: [], next_cursor: 'older/+/=' })).toEqual({
			notifications: [], next_cursor: 'older/+/=',
		});
	});

	test('validates notification identity, content, audience, timestamps and optional actions', () => {
		for (const patch of [
			{ id: '' }, { id: 1 }, { audience: 'everyone' }, { title: '' }, { message: null },
			{ created_at: 'invalid' }, { expires_at: '' }, { action_label: false }, { action_path: {} },
		]) {
			expect(() => parseNotificationFeed({ notifications: [{ ...notification, ...patch }] })).toThrow();
		}
		for (const audience of ['all', 'roles', 'admin']) {
			for (const severity of ['info', 'success', 'warning', 'error']) {
				const row = { ...notification, audience, severity, action_label: undefined, action_path: undefined };
				expect(parseNotificationFeed({ notifications: [row] }).notifications).toEqual([row]);
			}
		}
	});

	test('allows same-origin hash and absolute actions', () => {
		for (const path of ['/#/control-plane-projects', '#/usage-ledger', '/workspace/virtual-keys', '/workspace/providers?status=error']) {
			expect(isInternalNotificationPath(path)).toBe(true);
		}
	});

	test('rejects external, relative, backslash and browser-normalized control-character actions', () => {
		for (const path of [undefined, '', 'providers', 'https://example.com', 'javascript:alert(1)',
			'//example.com/workspace', '/\\evil.example', '/\t/evil.example', '/\n/evil.example',
			'/\r/evil.example', '/\0/evil.example', ' /workspace/providers', '#/providers\\test']) {
			expect(isInternalNotificationPath(path)).toBe(false);
			expect(notificationActionHref(path)).toBeUndefined();
		}
	});

	test('maps upstream workspace actions to panel hash routes without dropping query parameters', () => {
		expect(notificationActionHref('/workspace/virtual-keys')).toBe('#/virtual-keys');
		expect(notificationActionHref('/workspace/providers?status=error')).toBe('#/providers?status=error');
		expect(notificationActionHref('/#/control-plane-projects')).toBe('#/control-plane-projects');
		expect(notificationActionHref('#/usage-ledger')).toBe('#/usage-ledger');
		expect(notificationActionHref('/workspace-other/providers')).toBe('#/workspace-other/providers');
	});

	test('appends older pages in server order without duplicate keyed rows', () => {
		const older = { ...notification, id: 'older', created_at: '2026-10-26T08:00:00Z' };
		expect(appendNotificationPage([], [])).toEqual([]);
		expect(appendNotificationPage([], [notification])).toEqual([notification]);
		expect(appendNotificationPage([notification], [notification, older])).toEqual([notification, older]);
	});

	test('updates duplicate records without moving their position or mutating the existing page', () => {
		const older = { ...notification, id: 'older' };
		const updated = { ...notification, message: 'Updated budget event' };
		const current = [notification, older];
		expect(appendNotificationPage(current, [updated])).toEqual([updated, older]);
		expect(current).toEqual([notification, older]);
	});
});

describe('notification read receipt contracts', () => {
	const id = notification.id;
	const unread = { notification_id: id, read: false };
	const read = { notification_id: id, read: true, read_at: notification.created_at };
	test('requires explicit ordered state for every requested notification', () => {
		expect(parseNotificationReadStates({ data: [] }, [])).toEqual({});
		expect(parseNotificationReadStates({ data: [unread] }, [id])).toEqual({ [id]: unread });
		expect(parseNotificationReadState(read, id)).toEqual(read);
		for (const payload of [undefined, {}, { data: null }, { data: [] }, { data: [unread, unread] },
			{ data: [{ ...unread, notification_id: 'other' }] }]) {
			expect(() => parseNotificationReadStates(payload, [id])).toThrow();
		}
	});
	test('rejects missing/nonboolean read states and contradictory timestamps', () => {
		for (const payload of [null, {}, { ...unread, read: undefined }, { ...unread, read: 'false' },
			{ ...unread, read_at: null }, { ...unread, read_at: notification.created_at },
			{ ...read, read_at: undefined }, { ...read, read_at: 'invalid' }]) {
			expect(() => parseNotificationReadState(payload, id)).toThrow();
		}
	});
});
