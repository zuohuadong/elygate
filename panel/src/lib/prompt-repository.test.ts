import { describe, expect, test } from 'bun:test';
import { promptSessionHasCommitMessages } from './prompt-repository';

describe('prompt repository sessions', () => {
	test('rejects sessions without messages', () => {
		expect(promptSessionHasCommitMessages({ messages: [] })).toBe(false);
		expect(promptSessionHasCommitMessages({})).toBe(false);
	});

	test('mirrors the backend contract and accepts any persisted message row', () => {
		expect(promptSessionHasCommitMessages({ messages: [{ message: { role: 'user', content: 'Hello' } }] })).toBe(true);
		expect(promptSessionHasCommitMessages({ messages: [{ message: { role: 'user', content: null } }] })).toBe(true);
		expect(promptSessionHasCommitMessages({ messages: [{ message: { role: 'assistant', tool_calls: [{ id: 'call-1' }] } }] })).toBe(true);
	});
});
