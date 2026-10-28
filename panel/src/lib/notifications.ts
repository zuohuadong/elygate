import { isJsonRecord, type JsonRecord } from './api';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface PanelNotification {
	id: string;
	audience: 'all' | 'roles' | 'admin';
	severity: NotificationSeverity;
	title: string;
	message: string;
	action_label?: string;
	action_path?: string;
	created_at: string;
	expires_at: string;
}

export interface NotificationFeed {
	notifications: PanelNotification[];
	next_cursor?: string;
}

export interface NotificationReadState {
	notification_id: string;
	read: boolean;
	read_at?: string;
}

export function parseNotificationReadState(payload: unknown, id: string): NotificationReadState {
	if (!isJsonRecord(payload) || payload.notification_id !== id || typeof payload.read !== 'boolean'
		|| (payload.read
			? typeof payload.read_at !== 'string' || !Number.isFinite(Date.parse(payload.read_at))
			: payload.read_at !== undefined)) {
		throw new Error('Invalid notification read state response');
	}
	return { notification_id: id, read: payload.read, ...(payload.read ? { read_at: payload.read_at as string } : {}) };
}

export function parseNotificationReadStates(payload: unknown, ids: readonly string[]): Record<string, NotificationReadState> {
	if (!isJsonRecord(payload) || !Array.isArray(payload.data) || payload.data.length !== ids.length) {
		throw new Error('Invalid notification read state response');
	}
	const states: Record<string, NotificationReadState> = {};
	for (const [index, id] of ids.entries()) {
		states[id] = parseNotificationReadState(payload.data[index], id);
	}
	return states;
}

const SEVERITIES = new Set<NotificationSeverity>(['info', 'success', 'warning', 'error']);
const AUDIENCES = new Set<PanelNotification['audience']>(['all', 'roles', 'admin']);

function isNotification(value: JsonRecord): value is JsonRecord & PanelNotification {
	return typeof value.id === 'string' && value.id.length > 0
		&& typeof value.audience === 'string' && AUDIENCES.has(value.audience as PanelNotification['audience'])
		&& typeof value.severity === 'string' && SEVERITIES.has(value.severity as NotificationSeverity)
		&& typeof value.title === 'string' && value.title.length > 0
		&& typeof value.message === 'string' && value.message.length > 0
		&& typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at))
		&& typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at))
		&& (value.action_label === undefined || typeof value.action_label === 'string')
		&& (value.action_path === undefined || typeof value.action_path === 'string');
}

export function parseNotificationFeed(payload: unknown): NotificationFeed {
	if (!isJsonRecord(payload) || !Array.isArray(payload.notifications)) {
		throw new Error('Invalid notification feed response');
	}
	if (!payload.notifications.every(isJsonRecord) || !payload.notifications.every(isNotification)) {
		throw new Error('Invalid notification feed response');
	}
	if (payload.next_cursor !== undefined && typeof payload.next_cursor !== 'string') {
		throw new Error('Invalid notification feed response');
	}
	return {
		notifications: payload.notifications,
		...(payload.next_cursor ? { next_cursor: payload.next_cursor } : {}),
	};
}

export function isInternalNotificationPath(path: string | undefined): path is string {
	return typeof path === 'string'
		&& /^(?:\/(?!\/)|#\/)/.test(path)
		&& !/[\u0000-\u0020\u007f\\]/.test(path);
}

export function notificationActionHref(path: string | undefined): string | undefined {
	if (!isInternalNotificationPath(path)) return undefined;
	if (path.startsWith('#/')) return path;
	if (path.startsWith('/#/')) return path.slice(1);
	return `#${path.replace(/^\/workspace(?=\/)/, '')}`;
}

export function appendNotificationPage(
	current: readonly PanelNotification[],
	page: readonly PanelNotification[],
): PanelNotification[] {
	return [...new Map([...current, ...page].map((notification) => [notification.id, notification])).values()];
}
