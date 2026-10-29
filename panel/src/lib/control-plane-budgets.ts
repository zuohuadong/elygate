import { encodePathSegment, isJsonRecord, type JsonRecord } from './api';

export interface BudgetLimits {
	daily_budget: number | null;
	monthly_budget: number | null;
}

export interface BudgetStatus {
	scope_type: 'project' | 'application';
	scope_id: string;
	project_id: string;
	window: 'daily' | 'monthly';
	period_start: string;
	period_end: string;
	usage: number;
	limit: number;
	state: 'healthy' | 'warning' | 'exceeded';
}

export interface BudgetAlert {
	id: string;
	scope_type: 'project' | 'application';
	scope_id: string;
	window: 'daily' | 'monthly';
	period_start: string;
	threshold: number;
	usage: number;
	limit: number;
	triggered_at: string;
	acknowledged: boolean;
	acknowledged_at: string | null;
	acknowledged_by: string | null;
	resolved: boolean;
	resolved_at: string | null;
	resolved_by: string | null;
}

export type BudgetAlertResolution = 'all' | 'open' | 'resolved';

export function validBudgetInput(input: string): boolean {
	const value = input.trim();
	if (!value) return true;
	return /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
		&& Number.isFinite(Number(value)) && Number(value) > 0;
}

export function budgetLimits(daily: string, monthly: string): BudgetLimits {
	if (!validBudgetInput(daily) || !validBudgetInput(monthly)) throw new Error('invalid-budget-amount');
	return {
		daily_budget: daily.trim() ? Number(daily) : null,
		monthly_budget: monthly.trim() ? Number(monthly) : null,
	};
}

export function budgetEndpoint(scope: 'project' | 'application', id: string): string {
	if (!id) throw new Error('budget-scope-required');
	return `/api/control-plane/${scope === 'project' ? 'projects' : 'applications'}/${encodePathSegment(id)}/budgets`;
}

export function budgetQuery(project: string, application: string): URLSearchParams {
	const query = new URLSearchParams();
	if (project) query.set('project_id', project);
	if (application) query.set('application_id', application);
	return query;
}

export function formatBudgetAmount(amount: number, locale: string): string {
	if (amount !== 0 && Math.abs(amount) < 0.0001) return `$${amount.toExponential(3)}`;
	return new Intl.NumberFormat(locale, {
		style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 8,
	}).format(amount);
}

export function budgetProgress(usage: number, limit: number): number {
	return Math.min(100, Math.max(0, usage / limit * 100));
}

function budgetRecords(payload: unknown): JsonRecord[] {
	if (!isJsonRecord(payload) || !Array.isArray(payload.data) || !payload.data.every(isJsonRecord)) {
		throw new Error('Invalid budget response');
	}
	return payload.data;
}

function validBudgetRecord(row: JsonRecord): boolean {
	return (row.scope_type === 'project' || row.scope_type === 'application')
		&& typeof row.scope_id === 'string' && row.scope_id !== ''
		&& (row.window === 'daily' || row.window === 'monthly')
		&& typeof row.period_start === 'string' && Number.isFinite(Date.parse(row.period_start))
		&& typeof row.usage === 'number' && Number.isFinite(row.usage)
		&& typeof row.limit === 'number' && Number.isFinite(row.limit) && row.limit > 0;
}

function isBudgetStatus(row: JsonRecord): row is JsonRecord & BudgetStatus {
	return validBudgetRecord(row) && typeof row.project_id === 'string'
		&& typeof row.period_end === 'string' && Number.isFinite(Date.parse(row.period_end))
		&& (row.state === 'healthy' || row.state === 'warning' || row.state === 'exceeded');
}

function isBudgetAlert(row: JsonRecord): row is JsonRecord & BudgetAlert {
	return validBudgetRecord(row) && typeof row.id === 'string' && row.id !== ''
		&& (row.threshold === .8 || row.threshold === 1)
		&& typeof row.triggered_at === 'string' && Number.isFinite(Date.parse(row.triggered_at))
		&& (row.acknowledged === false
			? row.acknowledged_at === null && row.acknowledged_by === null
			: row.acknowledged === true
				&& typeof row.acknowledged_at === 'string' && Number.isFinite(Date.parse(row.acknowledged_at))
				&& typeof row.acknowledged_by === 'string' && row.acknowledged_by.trim() !== '')
		&& (row.resolved === false
			? row.resolved_at === null && row.resolved_by === null
			: row.resolved === true
				&& typeof row.resolved_at === 'string' && Number.isFinite(Date.parse(row.resolved_at))
				&& typeof row.resolved_by === 'string' && row.resolved_by.trim() !== '');
}

export function parseBudgetStatuses(payload: unknown): BudgetStatus[] {
	const rows = budgetRecords(payload);
	if (!rows.every(isBudgetStatus)) throw new Error('Invalid budget status response');
	return rows;
}

export function parseBudgetAlerts(payload: unknown): BudgetAlert[] {
	const rows = budgetRecords(payload);
	if (!rows.every(isBudgetAlert) || new Set(rows.map((row) => row.id)).size !== rows.length) {
		throw new Error('Invalid budget alert response');
	}
	return rows;
}

export function parseBudgetAcknowledgement(payload: unknown, id: string, acknowledged: boolean): BudgetAlert {
	if (!isJsonRecord(payload) || !isBudgetAlert(payload) || payload.id !== id || payload.acknowledged !== acknowledged) {
		throw new Error('Invalid budget acknowledgement response');
	}
	return payload;
}

export function parseBudgetResolution(payload: unknown, id: string, resolved: boolean): BudgetAlert {
	if (!isJsonRecord(payload) || !isBudgetAlert(payload) || payload.id !== id || payload.resolved !== resolved) {
		throw new Error('Invalid budget resolution response');
	}
	return payload;
}
