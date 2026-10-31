package controlplane

import (
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func TestUsageCSVExportIncludesEveryMatchingRow(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	// 边界：超过旧上限、同时间排序、所有维度交集、分页忽略及不匹配记录排除。
	const rowCount = 100001
	at := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	for offset := 0; offset < rowCount; offset += 500 {
		batch := make([]UsageLedgerEntry, 0, 500)
		for i := offset; i < offset+500 && i < rowCount; i++ {
			id := fmt.Sprintf("export-%06d", i)
			batch = append(batch, UsageLedgerEntry{
				ID: id, SourceLogID: id, VirtualKeyID: id, OccurredAt: at,
				ProjectID: "p", ApplicationID: "a", UserID: ptr("alice"), Provider: "openai", Model: "mini",
				SessionID: ptr("child"), ParentSessionID: ptr("root"), AgentName: ptr("worker"),
				IsSubagent: true, IsFork: true, Status: "success", TotalTokens: 3, Cost: 0.125,
			})
		}
		require.NoError(t, store.db(context.Background()).Create(&batch).Error)
	}
	require.NoError(t, store.db(context.Background()).Create(&UsageLedgerEntry{
		ID: "excluded", SourceLogID: "excluded", OccurredAt: at, ProjectID: "other",
	}).Error)
	_, total, err := store.ListUsage(context.Background(), UsageQuery{
		ProjectID: "p", ApplicationID: "a", UserID: "alice", Provider: "openai", Model: "mini",
		SessionID: "child", ParentSessionID: "root", TreeSessionID: "root", AgentName: "worker",
		IsSubagent: ptr(true), IsFork: ptr(true), StartTime: ptr(at), EndTime: ptr(at.Add(time.Hour)),
	})
	require.NoError(t, err)
	require.EqualValues(t, rowCount, total)
	routes := router.New()
	NewHandler(store, nil).RegisterRoutes(routes)
	request := &fasthttp.RequestCtx{}
	request.Request.SetRequestURI("http://admin.example.test/api/control-plane/usage/export?" +
		"project_id=p&application_id=a&user_id=alice&provider=openai&model=mini&session_id=child&" +
		"parent_session_id=root&tree_session_id=root&agent_name=worker&is_subagent=true&is_fork=true&" +
		"start_time=2026-10-31T01:00:00Z&end_time=2026-10-31T02:00:00Z&limit=1&offset=100000")
	request.SetUserValue(schemas.IsLocalAdminContextKey, true)
	routes.Handler(request)
	require.Equal(t, fasthttp.StatusOK, request.Response.StatusCode())
	defer request.Response.CloseBodyStream()
	var body io.Reader = request.Response.BodyStream()
	if body == nil {
		body = strings.NewReader(string(request.Response.Body()))
	}
	reader := csv.NewReader(body)
	header, err := reader.Read()
	require.NoError(t, err)
	require.Len(t, header, 18)
	for i := rowCount - 1; i >= 0; i-- {
		record, err := reader.Read()
		require.NoError(t, err, "missing row %d", i)
		require.Equal(t, fmt.Sprintf("export-%06d", i), record[3])
		require.Equal(t, "0.12500000", record[17])
	}
	_, err = reader.Read()
	require.ErrorIs(t, err, io.EOF)
}

func TestUsageCSVExportFileLifecycle(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	directory := t.TempDir()
	t.Setenv("TMPDIR", directory)
	handler := NewHandler(store, nil)
	// 边界：空账本、完整读取、提前终止、响应重置，均必须释放文件和数据库游标。
	for _, phase := range []string{"empty", "complete", "abandoned", "reset"} {
		t.Run(phase, func(t *testing.T) {
			if phase == "complete" {
				require.NoError(t, store.db(context.Background()).Create(&UsageLedgerEntry{
					ID: "csv-life", SourceLogID: "csv-life", OccurredAt: time.Now().UTC(),
					Model: "model,\"quoted\"\nnext line",
				}).Error)
			}
			request := &fasthttp.RequestCtx{}
			handler.exportUsage(request)
			require.Equal(t, fasthttp.StatusOK, request.Response.StatusCode())
			require.True(t, request.Response.IsBodyStream())
			require.Equal(t, true, request.UserValue(lib.FastHTTPUserValueLargeResponseMode))
			require.Contains(t, string(request.Response.Header.Peek("Content-Disposition")), "elygate-usage.csv")
			files, err := os.ReadDir(directory)
			require.NoError(t, err)
			require.Len(t, files, 1)
			info, err := files[0].Info()
			require.NoError(t, err)
			require.Equal(t, os.FileMode(0600), info.Mode().Perm())
			sqlDB, err := cs.DB().DB()
			require.NoError(t, err)
			require.Zero(t, sqlDB.Stats().InUse, "SQL cursor must close before sending the response")
			switch phase {
			case "empty", "complete":
				records, err := csv.NewReader(request.Response.BodyStream()).ReadAll()
				require.NoError(t, err)
				if phase == "empty" {
					require.Len(t, records, 1)
				} else {
					require.Len(t, records, 2)
					require.Equal(t, "model,\"quoted\"\nnext line", records[1][6])
				}
				require.NoError(t, request.Response.CloseBodyStream())
			case "abandoned":
				var firstByte [1]byte
				_, err := request.Response.BodyStream().Read(firstByte[:])
				require.NoError(t, err)
				require.NoError(t, request.Response.CloseBodyStream())
			case "reset":
				request.Response.Reset()
			}
			files, err = os.ReadDir(directory)
			require.NoError(t, err)
			require.Empty(t, files)
		})
	}
}

type usageExportWriterFunc func([]byte) (int, error)

func (write usageExportWriterFunc) Write(body []byte) (int, error) { return write(body) }

func TestUsageCSVExportFailuresReleaseResources(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	directory := t.TempDir()
	t.Setenv("TMPDIR", directory)
	ctx := context.Background()
	for i := range 80 {
		id := fmt.Sprintf("failure-%03d", i)
		require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{
			ID: id, SourceLogID: id, OccurredAt: time.Now().UTC(),
			Model: strings.Repeat("model", 50),
		}).Error)
	}
	sentinel := errors.New("private writer failure")
	t.Run("write failure", func(t *testing.T) {
		err := store.writeUsageCSV(ctx, UsageQuery{}, usageExportWriterFunc(func([]byte) (int, error) {
			return 0, sentinel
		}))
		require.ErrorIs(t, err, sentinel)
	})
	t.Run("flush failure", func(t *testing.T) {
		err := store.writeUsageCSV(ctx, UsageQuery{ProjectID: "absent"}, usageExportWriterFunc(func([]byte) (int, error) {
			return 0, sentinel
		}))
		require.ErrorIs(t, err, sentinel)
	})
	t.Run("cancel during cursor", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		err := store.writeUsageCSV(cancelCtx, UsageQuery{}, usageExportWriterFunc(func(body []byte) (int, error) {
			cancel()
			return len(body), nil
		}))
		require.ErrorIs(t, err, context.Canceled)
	})
	t.Run("cancel before generation", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(ctx)
		cancel()
		file, err := createUsageCSV(cancelCtx, store, UsageQuery{})
		require.ErrorIs(t, err, context.Canceled)
		require.Nil(t, file)
	})
	t.Run("scan failure", func(t *testing.T) {
		broken := *store
		broken.tx = store.db(ctx).Select("'not-a-number' AS cost")
		file, err := createUsageCSV(ctx, &broken, UsageQuery{})
		require.ErrorContains(t, err, "converting")
		require.Nil(t, file)
	})
	t.Run("database failure has no partial attachment", func(t *testing.T) {
		broken := *store
		broken.tx = store.db(ctx).Where("private_export_column = ?", "private")
		request := &fasthttp.RequestCtx{}
		NewHandler(&broken, nil).exportUsage(request)
		require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
		require.False(t, request.Response.IsBodyStream())
		require.Empty(t, request.Response.Header.Peek("Content-Disposition"))
		require.JSONEq(t, `{"error":"usage export could not be generated"}`, string(request.Response.Body()))
	})
	t.Run("temporary directory failure", func(t *testing.T) {
		t.Setenv("TMPDIR", filepath.Join(directory, "missing"))
		request := &fasthttp.RequestCtx{}
		NewHandler(store, nil).exportUsage(request)
		require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
		require.JSONEq(t, `{"error":"usage export could not be generated"}`, string(request.Response.Body()))
	})
	files, err := os.ReadDir(directory)
	require.NoError(t, err)
	require.Empty(t, files)
	sqlDB, err := cs.DB().DB()
	require.NoError(t, err)
	require.Zero(t, sqlDB.Stats().InUse)
}

func TestUsageCSVExportRejectsUnauthorizedAndInvalidRequests(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	directory := t.TempDir()
	t.Setenv("TMPDIR", directory)
	routes := router.New()
	NewHandler(store, nil).RegisterRoutes(routes)
	for _, tc := range []struct {
		name, query   string
		admin, bypass bool
		status        int
	}{
		{"anonymous", "", false, false, 401},
		{"bypass", "", true, true, 403},
		{"bad time", "?start_time=bad", true, false, 400},
		{"bad boolean", "?is_fork=bad", true, false, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := &fasthttp.RequestCtx{}
			request.Request.SetRequestURI("http://admin.example.test/api/control-plane/usage/export" + tc.query)
			request.SetUserValue(schemas.IsLocalAdminContextKey, tc.admin)
			request.SetUserValue(schemas.BifrostContextKeyAuthBypassed, tc.bypass)
			routes.Handler(request)
			require.Equal(t, tc.status, request.Response.StatusCode())
			require.False(t, request.Response.IsBodyStream())
		})
	}
	files, err := os.ReadDir(directory)
	require.NoError(t, err)
	require.Empty(t, files)
}

func TestUsageCSVExportSnapshotDuringConcurrentMutation(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	at := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	for i := range 80 {
		id := fmt.Sprintf("snapshot-%03d", i)
		require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{
			ID: id, SourceLogID: id, VirtualKeyID: id, OccurredAt: at,
			Model: strings.Repeat("model", 50), Cost: 0.125,
		}).Error)
	}
	var csvBody bytes.Buffer
	mutated := false
	err := store.writeUsageCSV(ctx, UsageQuery{}, usageExportWriterFunc(func(body []byte) (int, error) {
		if !mutated {
			mutated = true
			if err := store.db(ctx).Transaction(func(tx *gorm.DB) error {
				if err := tx.Model(&UsageLedgerEntry{}).Where("id = ?", "snapshot-000").
					Updates(map[string]any{"cost": 99, "model": "changed", "occurred_at": at.Add(time.Hour)}).Error; err != nil {
					return err
				}
				if err := tx.Delete(&UsageLedgerEntry{}, "id = ?", "snapshot-001").Error; err != nil {
					return err
				}
				return tx.Create(&UsageLedgerEntry{
					ID: "snapshot-new", SourceLogID: "snapshot-new", VirtualKeyID: "snapshot-new",
					OccurredAt: at.Add(time.Hour),
				}).Error
			}); err != nil {
				return 0, err
			}
		}
		return csvBody.Write(body)
	}))
	require.NoError(t, err)
	require.True(t, mutated)
	records, err := csv.NewReader(&csvBody).ReadAll()
	require.NoError(t, err)
	require.Len(t, records, 81)
	for i, record := range records[1:] {
		require.Equal(t, fmt.Sprintf("snapshot-%03d", 79-i), record[3])
		require.Equal(t, strings.Repeat("model", 50), record[6])
		require.Equal(t, "0.12500000", record[17])
	}
	summary, err := store.SummarizeUsage(ctx, UsageQuery{})
	require.NoError(t, err)
	require.EqualValues(t, 80, summary.Requests)
	require.InDelta(t, 99+78*0.125, summary.Cost, 0.000001)
}

func TestUsageCSVExportHTTPStreamCleanup(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	directory := t.TempDir()
	t.Setenv("TMPDIR", directory)
	require.NoError(t, store.db(context.Background()).Create(&UsageLedgerEntry{
		ID: "transport", SourceLogID: "transport", OccurredAt: time.Now().UTC(),
	}).Error)
	routes := router.New()
	// 只验证已鉴权处理器的 HTTP 流传输，不代替完整登录或生产代理验收。
	NewHandler(store, nil).RegisterRoutes(routes, func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
			next(ctx)
		}
	})
	server := &fasthttp.Server{Handler: routes.Handler}
	for _, disconnect := range []bool{false, true} {
		t.Run(fmt.Sprintf("disconnect=%t", disconnect), func(t *testing.T) {
			serverConn, clientConn := net.Pipe()
			t.Cleanup(func() { _ = clientConn.Close(); _ = serverConn.Close() })
			require.NoError(t, clientConn.SetDeadline(time.Now().Add(10*time.Second)))
			require.NoError(t, serverConn.SetDeadline(time.Now().Add(10*time.Second)))
			finished := make(chan error, 1)
			go func() { finished <- server.ServeConn(serverConn) }()
			_, err := io.WriteString(clientConn, "GET /api/control-plane/usage/export HTTP/1.1\r\nHost: admin.example.test\r\nConnection: close\r\n\r\n")
			require.NoError(t, err)
			if disconnect {
				require.NoError(t, clientConn.Close())
				require.Error(t, <-finished)
			} else {
				response, err := http.ReadResponse(bufio.NewReader(clientConn), nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, response.StatusCode)
				require.Equal(t, "text/csv; charset=utf-8", response.Header.Get("Content-Type"))
				records, err := csv.NewReader(response.Body).ReadAll()
				require.NoError(t, err)
				require.Len(t, records, 2)
				require.NoError(t, response.Body.Close())
				require.NoError(t, <-finished)
			}
			files, err := os.ReadDir(directory)
			require.NoError(t, err)
			require.Empty(t, files)
		})
	}
}

func BenchmarkUsageCSVRecord(b *testing.B) {
	entry := &UsageLedgerEntry{
		OccurredAt: time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC),
		ProjectID:  "p", ApplicationID: "a", Provider: "openai", Model: "mini",
		Status: "success", TotalTokens: 15, Cost: 0.125,
	}
	b.ReportAllocs()
	for b.Loop() {
		writer := csv.NewWriter(&bytes.Buffer{})
		require.NoError(b, writer.Write(usageCSVRecord(entry)))
		writer.Flush()
		require.NoError(b, writer.Error())
	}
}

func BenchmarkUsageCSVExport(b *testing.B) {
	ctx := context.Background()
	cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(b.TempDir(), "export.db")},
	}, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(b, err)
	b.Cleanup(func() { require.NoError(b, cs.Close(ctx)) })
	store, err := NewStore(ctx, cs)
	require.NoError(b, err)
	b.Setenv("TMPDIR", b.TempDir())
	for i := range 1000 {
		id := fmt.Sprintf("bench-%06d", i)
		require.NoError(b, store.db(ctx).Create(&UsageLedgerEntry{
			ID: id, SourceLogID: id, OccurredAt: time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC),
			ProjectID: "p", ApplicationID: "a", Provider: "openai", Model: "mini",
			Status: "success", PromptTokens: 10, OutputTokens: 5, TotalTokens: 15, Cost: 0.125,
		}).Error)
	}
	handler := NewHandler(store, nil)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		request := &fasthttp.RequestCtx{}
		handler.exportUsage(request)
		if request.Response.StatusCode() != fasthttp.StatusOK {
			b.Fatal("export failed")
		}
		if stream := request.Response.BodyStream(); stream != nil {
			_, err := io.Copy(io.Discard, stream)
			require.NoError(b, err)
			require.NoError(b, request.Response.CloseBodyStream())
		} else {
			_, err := io.Discard.Write(request.Response.Body())
			require.NoError(b, err)
		}
	}
}
