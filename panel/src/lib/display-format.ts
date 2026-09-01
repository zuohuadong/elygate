export function formatUsdCost(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—';
	const amount = Number(value);
	return Number.isFinite(amount) ? `$${amount.toFixed(4)}` : '—';
}

export function formatRankedCost(value: unknown, isFree: boolean, locale: string): string {
	const formatted = formatUsdCost(value);
	return typeof value === 'number' && Number.isFinite(value) && value === 0 && isFree
		? `${formatted} · ${locale.startsWith('zh') ? '免费' : 'Free'}`
		: formatted;
}

export function paginationPageCount(total: number, pageSize: number): number {
	if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(pageSize) || pageSize <= 0) return 1;
	return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPaginationPage(page: number, total: number, pageSize: number): number {
	if (!Number.isFinite(page) || page < 1) return 1;
	return Math.min(Math.floor(page), paginationPageCount(total, pageSize));
}

export function formatPagination(page: number, pages: number, total: number, locale: string): string {
	const safePage = Math.max(1, Math.floor(page) || 1);
	const safePages = Math.max(1, Math.floor(pages) || 1);
	const safeTotal = Math.max(0, Math.floor(total) || 0).toLocaleString(locale);
	return locale.startsWith('zh')
		? `第 ${safePage} / ${safePages} 页 · 共 ${safeTotal} 条`
		: `Page ${safePage} / ${safePages} · ${safeTotal} total`;
}
