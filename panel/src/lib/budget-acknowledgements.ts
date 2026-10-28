import { encodePathSegment, requestJson } from './api';
import { parseBudgetAcknowledgement, type BudgetAlert } from './control-plane-budgets';

const pendingAcknowledgements = new Set<Promise<BudgetAlert>>();

export async function saveBudgetAcknowledgement(id: string, acknowledged: boolean): Promise<BudgetAlert> {
	// Keep the write alive across scope changes and component unmounts:
	// cancelling fetch would not cancel the server's transaction.
	const pending = requestJson<unknown>(`/api/control-plane/budget-alerts/${encodePathSegment(id)}/acknowledgement`, {
		method: 'PUT', body: JSON.stringify({ acknowledged }),
	}).then((payload) => parseBudgetAcknowledgement(payload, id, acknowledged));
	pendingAcknowledgements.add(pending);
	try {
		return await pending;
	} finally {
		pendingAcknowledgements.delete(pending);
	}
}

export async function waitForBudgetAcknowledgements(): Promise<void> {
	// A failed response is not proof of rollback; callers read fresh state
	// rather than turning a failed write into a successful acknowledgement.
	await Promise.allSettled([...pendingAcknowledgements]);
}
