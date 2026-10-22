package logstore

import (
	"context"
	"errors"
)

// usageScanBatchSize bounds a single visit() call so reconciling a large
// retained log store never materializes every terminal row in memory at once.
const usageScanBatchSize = 500

// usageScanColumns is the subset of the logs table the usage ledger projection
// reads. It deliberately excludes the payload columns (input history, output
// message, error details), which can be large and are never projected.
const usageScanColumns = `id, timestamp, status, provider, model,
	virtual_key_id, team_id, customer_id, user_id,
	session_id, parent_session_id, agent_name, session_client_type,
	is_subagent, is_fork,
	prompt_tokens, completion_tokens, total_tokens, cost`

// ScanUsageLogs streams every retained terminal log row from one statement
// snapshot, batch by batch, so the control plane can rebuild its usage ledger
// from the source of truth rather than from request timestamps.
//
// It intentionally does not use a timestamp watermark as the change cursor:
// both completion and repricing can change rows older than any such mark.
// Callers that want incremental behavior use the checkpoint reuse window at
// the handler layer instead.
func (s *RDBLogStore) ScanUsageLogs(ctx context.Context, visit func([]Log) error) error {
	if visit == nil {
		return errors.New("usage log scan requires a visitor")
	}
	db := s.ScopedDB(ctx)
	rows, err := db.Model(&Log{}).
		Select(usageScanColumns).
		Where("status IN ?", terminalLogStatuses).
		Order("id ASC").
		Rows()
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	page := make([]Log, 0, usageScanBatchSize)
	for rows.Next() {
		var entry Log
		if err := db.ScanRows(rows, &entry); err != nil {
			return err
		}
		page = append(page, entry)
		if len(page) == usageScanBatchSize {
			if err := visit(page); err != nil {
				return err
			}
			page = make([]Log, 0, usageScanBatchSize)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(page) > 0 {
		return visit(page)
	}
	return nil
}

// UsageLogSnapshotComplete reports that ScanUsageLogs always returns every
// retained terminal row: the scan is unbounded, so the projection it produces
// is a complete snapshot and stale ledger entries may be deleted.
func (s *RDBLogStore) UsageLogSnapshotComplete() bool { return true }

// ScanUsageLogs forwards to the backing store. Hybrid only offloads payload
// columns, so the projection-visible columns are the same rows.
func (h *HybridLogStore) ScanUsageLogs(ctx context.Context, visit func([]Log) error) error {
	if h == nil || h.inner == nil {
		return errors.New("log store not initialized")
	}
	reader, ok := h.inner.(UsageLogReader)
	if !ok {
		return errors.New("log store does not support consistent usage reconciliation")
	}
	return reader.ScanUsageLogs(ctx, visit)
}

// UsageLogSnapshotComplete forwards the backing store's completeness signal.
func (h *HybridLogStore) UsageLogSnapshotComplete() bool {
	if h == nil || h.inner == nil {
		return false
	}
	reader, ok := h.inner.(UsageLogSnapshotReader)
	return ok && reader.UsageLogSnapshotComplete()
}

// Compile-time pins: the control plane resolves these capabilities through
// interface assertions, so a store that silently lost them would turn every
// usage-ledger read into a 500 instead of a build failure.
var (
	_ UsageLogReader         = (*RDBLogStore)(nil)
	_ UsageLogSnapshotReader = (*RDBLogStore)(nil)
	_ UsageLogReader         = (*HybridLogStore)(nil)
	_ UsageLogSnapshotReader = (*HybridLogStore)(nil)
)
