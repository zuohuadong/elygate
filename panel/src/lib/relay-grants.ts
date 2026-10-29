import { isJsonRecord } from './api';

export function relayGrantNames(value: unknown): string[] {
	if (value == null) return [];
	if (!Array.isArray(value)) throw new Error('invalid-relay-grants');
	const names = value.map((grant) => {
		if (!isJsonRecord(grant) || typeof grant.relay_name !== 'string') throw new Error('invalid-relay-grants');
		return grant.relay_name;
	});
	validateRelayNames(names);
	return names;
}

function validateRelayNames(names: string[]): void {
	if (new Set(names).size !== names.length || names.some((name) => !/^[A-Za-z0-9._-]{1,64}$/.test(name) || name === '.' || name === '..')) throw new Error('invalid-relay-grants');
}

export function relayGrantsPayload(names: string[], initial?: string[]): { relay_name: string }[] | undefined {
	validateRelayNames(names);
	if (initial && names.length === initial.length && names.every((name) => initial.includes(name))) return undefined;
	return names.map((relay_name) => ({ relay_name }));
}
