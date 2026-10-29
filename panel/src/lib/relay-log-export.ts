import { isJsonRecord, type JsonRecord } from './api';

export const RELAY_LOG_EXPORT_MAX = 10_000;
export const RELAY_LOG_EXPORT_BATCH_SIZE = 1_000;

export const RELAY_LOG_CSV_HEADERS = [
	'Time', 'Request ID', 'Status', 'Relay', 'Kind', 'Method', 'Path', 'Route', 'Model', 'App', 'User Agent',
	'Latency (ms)', 'Upstream Latency (ms)', 'Overhead (ms)', 'Bytes Out', 'Billable', 'Streamed', 'Units',
	'Billed Units', 'Cost per Request ($)', 'Cost per Unit ($)', 'Reported Cost ($)', 'Cost ($)', 'Input Tokens',
	'Output Tokens', 'Total Tokens', 'Virtual Key', 'Team', 'Customer', 'User', 'Business Unit', 'Project', 'Job ID',
] as const;

function textField(record: JsonRecord, key: string): string {
	const field = record[key];
	return field === null || field === undefined ? '' : String(field);
}

function firstTextField(record: JsonRecord, primaryKey: string, fallbackKey: string): string {
	return textField(record, primaryKey) || textField(record, fallbackKey);
}

function joinedAttribution(record: JsonRecord, dimension: string): string {
	const names = record[`${dimension}_names`];
	const ids = record[`${dimension}_ids`];
	if (Array.isArray(ids) && ids.length) return ids.map((id, index) => Array.isArray(names) && names[index] ? String(names[index]) : String(id)).join('; ');
	if (Array.isArray(names) && names.length) return names.map(String).join('; ');
	return firstTextField(record, `${dimension}_name`, `${dimension}_id`);
}

function numericField(record: JsonRecord, key: string): number | string {
	const field = record[key];
	return field === null || field === undefined || field === '' ? '' : (typeof field === 'number' ? field : String(field));
}

function csvCell(field: unknown): string {
	if (field === null || field === undefined) return '';
	const raw = String(field);
	const protectedValue = typeof field === 'string' && /^(?:\s*[=+@-]|[\t\r\n])/.test(raw) ? `'${raw}` : raw;
	return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function relayLogCsvRow(record: JsonRecord): unknown[] {
	return [
		textField(record, 'timestamp'), textField(record, 'request_id'), textField(record, 'status'),
		textField(record, 'relay_name'), textField(record, 'kind'), textField(record, 'method'), textField(record, 'path'),
		textField(record, 'route_path'), textField(record, 'model'), textField(record, 'app'),
		textField(record, 'user_agent'), numericField(record, 'latency'), numericField(record, 'upstream_latency'),
		numericField(record, 'overhead_latency'), numericField(record, 'bytes_out'),
		Boolean(record.billable), Boolean(record.streamed), numericField(record, 'units'), numericField(record, 'billed_units'),
		numericField(record, 'cost_per_request'), numericField(record, 'cost_per_unit'), numericField(record, 'extracted_cost'),
		numericField(record, 'cost'), numericField(record, 'input_tokens'), numericField(record, 'output_tokens'),
		numericField(record, 'total_tokens'),
		firstTextField(record, 'virtual_key_name', 'virtual_key_id'),
		joinedAttribution(record, 'team'),
		joinedAttribution(record, 'customer'),
		firstTextField(record, 'user_name', 'user_id'),
		joinedAttribution(record, 'business_unit'),
		firstTextField(record, 'project_name', 'project_id'), textField(record, 'job_id'),
	];
}

export function relayLogsToCsv(records: JsonRecord[]): string {
	return [RELAY_LOG_CSV_HEADERS, ...records.map(relayLogCsvRow)].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const relayLogExportFields = [
	'id', 'timestamp', 'request_id', 'status', 'relay_name', 'kind', 'method', 'path', 'route_path', 'model', 'app', 'user_agent',
	'latency', 'upstream_latency', 'overhead_latency', 'bytes_out', 'billable', 'streamed', 'units', 'billed_units',
	'cost_per_request', 'cost_per_unit', 'extracted_cost', 'cost', 'input_tokens', 'output_tokens', 'total_tokens', 'job_id',
	...['virtual_key', 'team', 'customer', 'user', 'business_unit', 'project'].flatMap((dimension) => [`${dimension}_id`, `${dimension}_name`, `${dimension}_ids`, `${dimension}_names`]),
];

function exportRecord(record: JsonRecord): JsonRecord {
	return Object.fromEntries(relayLogExportFields.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

export function exportTargetCount(total: number, requestedLimit: string): number {
	const normalizedTotal = Math.max(0, Math.floor(total));
	if (!requestedLimit.trim()) return Math.min(normalizedTotal, RELAY_LOG_EXPORT_MAX);
	const limit = Number(requestedLimit);
	if (!Number.isInteger(limit) || limit < 1 || limit > RELAY_LOG_EXPORT_MAX) throw new Error('invalid-export-limit');
	return Math.min(normalizedTotal, limit);
}

export function relayLogPage(payload: unknown): { logs: JsonRecord[]; total: number } {
	if (!isJsonRecord(payload) || !isJsonRecord(payload.pagination)) throw new Error('invalid-relay-log-page');
	const total = payload.pagination.total_count;
	const logs = payload.logs === null ? [] : payload.logs;
	if (!Array.isArray(logs) || !logs.every((record) => isJsonRecord(record) && typeof record.id === 'string' && record.id !== '')) throw new Error('invalid-relay-log-page');
	if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new Error('invalid-relay-log-page');
	return { logs, total };
}

export function relayLogListUrl(query: string, pagination: { limit: number; offset: number; sortBy: string; order: string }): string {
	const params = new URLSearchParams(query);
	params.set('limit', String(pagination.limit));
	params.set('offset', String(pagination.offset));
	params.set('sort_by', pagination.sortBy);
	params.set('order', pagination.order);
	return `/api/relay-logs?${params.toString()}`;
}

export interface RelayLogExportRequest {
	target: number;
	signal: AbortSignal;
	fetchBatch: (offset: number, limit: number) => Promise<unknown>;
	onProgress: (current: number) => void;
}

export async function collectRelayLogExport(request: RelayLogExportRequest): Promise<JsonRecord[]> {
	const records: JsonRecord[] = [];
	const seen = new Set<string>();
	let offset = 0;
	// Cap scanned rows as well as retained rows so repeated pages cannot keep an export alive.
	while (offset < RELAY_LOG_EXPORT_MAX && records.length < request.target) {
		request.signal.throwIfAborted();
		const limit = Math.min(RELAY_LOG_EXPORT_BATCH_SIZE, request.target - records.length, RELAY_LOG_EXPORT_MAX - offset);
		const batch = relayLogPage(await request.fetchBatch(offset, limit)).logs;
		request.signal.throwIfAborted();
		if (batch.length > limit) throw new Error('invalid-relay-log-page');
		const previousCount = records.length;
		for (const record of batch) {
			const id = record.id as string;
			if (seen.has(id)) continue;
			seen.add(id);
			records.push(exportRecord(record));
		}
		if (batch.length && records.length === previousCount) throw new Error('repeating-relay-log-page');
		request.onProgress(records.length);
		offset += batch.length;
		if (batch.length < limit) break;
	}
	if (offset >= RELAY_LOG_EXPORT_MAX && records.length < request.target) throw new Error('relay-log-export-scan-limit');
	return records;
}
