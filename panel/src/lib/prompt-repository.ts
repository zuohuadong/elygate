import type { JsonRecord } from './api';

export function promptSessionHasCommitMessages(session: JsonRecord): boolean {
	return Array.isArray(session.messages) && session.messages.length > 0;
}
