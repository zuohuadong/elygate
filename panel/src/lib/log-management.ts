export interface CostRecalculationStatus {
	id?: string;
	status: string;
	total?: number;
	processed?: number;
	updated?: number;
	skipped?: number;
	unpriceable?: number;
	message?: string;
	last_error?: string;
}

export function logPageCount(total: number, pageSize: number): number {
	if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(pageSize) || pageSize <= 0) return 1;
	return Math.max(1, Math.ceil(total / pageSize));
}

export function clampLogPage(page: number, total: number, pageSize: number): number {
	if (!Number.isFinite(page) || page < 1) return 1;
	return Math.min(Math.floor(page), logPageCount(total, pageSize));
}

export function isCostRecalculationStatus(value: unknown): value is CostRecalculationStatus {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& typeof (value as { status?: unknown }).status === 'string';
}

export function isCostRecalculationActive(status: CostRecalculationStatus): boolean {
	return status.status === 'pending' || status.status === 'running';
}

export function formatLogCost(value: unknown, fractionDigits: number): string {
	if (value === null || value === undefined || value === '') return '—';
	const amount = Number(value);
	return Number.isFinite(amount) ? `$${amount.toFixed(fractionDigits)}` : '—';
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, milliseconds);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

export async function waitForCostRecalculation(
	jobID: string,
	loadStatus: (jobID: string) => Promise<CostRecalculationStatus>,
	options: { intervalMs?: number; maxAttempts?: number; signal?: AbortSignal; wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<CostRecalculationStatus> {
	const intervalMs = options.intervalMs ?? 1_000;
	const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
	const wait = options.wait ?? delay;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		if (attempt > 0) await wait(intervalMs, options.signal);
		const status = await loadStatus(jobID);
		if (!isCostRecalculationActive(status)) return status;
	}
	throw new Error('cost-recalculation-timeout');
}
