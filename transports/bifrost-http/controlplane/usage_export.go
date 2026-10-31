package controlplane

import (
	"context"
	"encoding/csv"
	"errors"
	"io"
	"os"
	"strconv"
	"time"

	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

var usageCSVHeader = []string{
	"occurred_at", "project_id", "application_id", "virtual_key_id", "user_id",
	"provider", "model", "session_id", "parent_session_id", "agent_name",
	"session_client_type", "is_subagent", "is_fork", "status", "prompt_tokens",
	"output_tokens", "total_tokens", "cost",
}

func (h *Handler) exportUsage(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	query, err := h.usageQuery(ctx)
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	if err := h.syncUsage(opCtx, query.StartTime, query.EndTime, false); err != nil {
		writeError(ctx, 500, err)
		return
	}
	exportFile, err := createUsageCSV(opCtx, h.store, query)
	if err != nil {
		writeError(ctx, 500, errors.New("usage export could not be generated"))
		return
	}
	ctx.SetStatusCode(200)
	ctx.Response.Header.SetContentType("text/csv; charset=utf-8")
	ctx.Response.Header.Set("Content-Disposition", `attachment; filename="elygate-usage.csv"`)
	ctx.Response.SetBodyStream(exportFile, -1)
	ctx.SetUserValue(lib.FastHTTPUserValueLargeResponseMode, true)
}

func createUsageCSV(ctx context.Context, store *Store, query UsageQuery) (*usageCSVFile, error) {
	file, err := os.CreateTemp("", "elygate-usage-*.csv")
	if err != nil {
		return nil, err
	}
	exportFile := &usageCSVFile{File: file}
	if err := store.writeUsageCSV(ctx, query, file); err != nil {
		return nil, errors.Join(err, exportFile.Close())
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, errors.Join(err, exportFile.Close())
	}
	if err := ctx.Err(); err != nil {
		return nil, errors.Join(err, exportFile.Close())
	}
	return exportFile, nil
}

func (s *Store) writeUsageCSV(ctx context.Context, query UsageQuery, destination io.Writer) (exportErr error) {
	// 单个 SELECT 的快照避免跨分页导出时混入并发修改，CSV 不保留整个账本。
	db := applyUsageFilters(s.db(ctx), query).Model(&UsageLedgerEntry{}).Order("occurred_at DESC, id DESC")
	rows, err := db.Rows()
	if err != nil {
		return err
	}
	defer func() { exportErr = errors.Join(exportErr, rows.Close()) }()
	writer := csv.NewWriter(destination)
	if err := writer.Write(usageCSVHeader); err != nil {
		return err
	}
	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		var entry UsageLedgerEntry
		if err := db.ScanRows(rows, &entry); err != nil {
			return err
		}
		if err := writer.Write(usageCSVRecord(&entry)); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writer.Flush()
	return errors.Join(writer.Error(), ctx.Err())
}

func usageCSVRecord(entry *UsageLedgerEntry) []string {
	return []string{
		entry.OccurredAt.Format(time.RFC3339), csvText(entry.ProjectID), csvText(entry.ApplicationID),
		csvText(entry.VirtualKeyID), csvOptionalString(entry.UserID), csvText(entry.Provider), csvText(entry.Model),
		csvOptionalString(entry.SessionID), csvOptionalString(entry.ParentSessionID), csvOptionalString(entry.AgentName),
		csvOptionalString(entry.SessionClientType), strconv.FormatBool(entry.IsSubagent), strconv.FormatBool(entry.IsFork),
		csvText(entry.Status), strconv.Itoa(entry.PromptTokens), strconv.Itoa(entry.OutputTokens),
		strconv.Itoa(entry.TotalTokens), strconv.FormatFloat(entry.Cost, 'f', 8, 64),
	}
}

type usageCSVFile struct {
	*os.File
}

func (f *usageCSVFile) Close() error {
	return errors.Join(f.File.Close(), os.Remove(f.Name()))
}
