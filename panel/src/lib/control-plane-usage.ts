export interface UsageSummary {
	requests: number;
	successful_requests: number;
	failed_requests: number;
	cancelled_requests: number;
	prompt_tokens: number;
	output_tokens: number;
	total_tokens: number;
	cost: number;
}

export function usageTimeRange(
	startInput: string,
	endInput: string,
	errors: { start: string; end: string; range: string },
): { start?: string; end?: string } {
	const start = startInput.trim() ? new Date(startInput.trim()) : undefined;
	const end = endInput.trim() ? new Date(endInput.trim()) : undefined;
	if (start && Number.isNaN(start.getTime())) throw new Error(errors.start);
	if (end && Number.isNaN(end.getTime())) throw new Error(errors.end);
	if (start && end && start >= end) throw new Error(errors.range);
	return { start: start?.toISOString(), end: end?.toISOString() };
}
