package vectorstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	_ "github.com/mattn/go-sqlite3"
	"github.com/maximhq/bifrost/core/schemas"
)

// SqliteConfig configures the SQLite vector store. The file is usually the same
// database the config store uses, so a single-file deployment keeps its vectors
// next to its configuration. sqlite-vec is compiled into the binary, so no
// separate extension install is required.
type SqliteConfig struct {
	Path string `json:"path,omitempty"`
}

// SqliteStore stores one table per namespace in a SQLite database. Embeddings
// are serialized float32 blobs read by sqlite-vec's vec_distance_cosine()
// function, which keeps the on-disk format stable across sqlite-vec releases.
type SqliteStore struct {
	db *sql.DB
}

const sqliteNamespaceRegistry = "bifrost_vec_sqlite_namespaces"

// ValidateSqliteConfig validates persisted SQLite vector settings without
// opening the database. An empty path is allowed only when the caller fills in
// the config store's path (the auto mode does that during startup).
func ValidateSqliteConfig(config *SqliteConfig, requirePath bool) error {
	if config == nil {
		return fmt.Errorf("sqlite vector config is required")
	}
	if requirePath && strings.TrimSpace(config.Path) == "" {
		return fmt.Errorf("sqlite vector path is required")
	}
	return nil
}

func newSqliteStore(ctx context.Context, config *SqliteConfig, _ schemas.Logger) (*SqliteStore, error) {
	if err := ValidateSqliteConfig(config, true); err != nil {
		return nil, err
	}
	path := strings.TrimSpace(config.Path)
	// Register sqlite-vec on every future connection before opening ours. The
	// call is idempotent and also applies to the config store's own handle.
	sqlite_vec.Auto()
	dsn := path
	if path != ":memory:" && !strings.Contains(path, "mode=memory") {
		separator := "?"
		if strings.Contains(path, "?") {
			separator = "&"
		}
		// Share the config store's file without failing on its write lock: WAL
		// lets readers proceed while a writer commits, and the busy timeout
		// makes vector writes wait rather than erroring.
		dsn = path + separator + "_journal_mode=WAL&_busy_timeout=60000&_synchronous=NORMAL"
	}
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite vector store: %w", err)
	}
	if path == ":memory:" || strings.Contains(path, "mode=memory") {
		// Every pooled connection to an in-memory database is a different
		// database; pin the pool so namespaces survive across calls.
		db.SetMaxOpenConns(1)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to connect to sqlite vector store: %w", err)
	}
	var vecVersion string
	if err := db.QueryRowContext(ctx, `SELECT vec_version()`).Scan(&vecVersion); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("sqlite-vec extension is not available: %w", err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS `+sqliteNamespaceRegistry+` (
		namespace TEXT PRIMARY KEY,
		table_name TEXT NOT NULL UNIQUE,
		dimension INTEGER NOT NULL,
		created_at TEXT NOT NULL
	)`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to create sqlite vector namespace registry: %w", err)
	}
	return &SqliteStore{db: db}, nil
}

func (s *SqliteStore) Ping(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("sqlite vector store is not initialized")
	}
	return s.db.PingContext(ctx)
}

func (s *SqliteStore) CreateNamespace(ctx context.Context, namespace string, dimension int, _ map[string]VectorStoreProperties) error {
	if dimension <= 0 {
		return fmt.Errorf("sqlite namespace dimension must be greater than 0")
	}
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin sqlite namespace transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
		id TEXT PRIMARY KEY,
		embedding BLOB NOT NULL,
		metadata TEXT NOT NULL DEFAULT '{}'
	)`, quoteSqliteIdentifier(table))); err != nil {
		return fmt.Errorf("failed to create sqlite namespace: %w", err)
	}
	var existing int
	err = tx.QueryRowContext(ctx, `SELECT dimension FROM `+sqliteNamespaceRegistry+` WHERE namespace = ?`, namespace).Scan(&existing)
	switch {
	case err == sql.ErrNoRows:
		if _, err := tx.ExecContext(ctx, `INSERT INTO `+sqliteNamespaceRegistry+` (namespace, table_name, dimension, created_at) VALUES (?, ?, ?, ?)`,
			namespace, table, dimension, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("failed to register sqlite namespace: %w", err)
		}
	case err != nil:
		return fmt.Errorf("failed to inspect sqlite namespace: %w", err)
	case existing != dimension:
		return fmt.Errorf("namespace %q already exists with dimension %d but config requires %d; use a new vector_store_namespace or remove the existing namespace", namespace, existing, dimension)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS `+quoteSqliteIdentifier(table+"_id")+` ON `+quoteSqliteIdentifier(table)+` (id)`); err != nil {
		return fmt.Errorf("failed to create sqlite namespace index: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit sqlite namespace: %w", err)
	}
	return nil
}

func (s *SqliteStore) DeleteNamespace(ctx context.Context, namespace string) error {
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin sqlite namespace transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS `+quoteSqliteIdentifier(table)); err != nil {
		return fmt.Errorf("failed to delete sqlite namespace: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM `+sqliteNamespaceRegistry+` WHERE namespace = ?`, namespace); err != nil {
		return fmt.Errorf("failed to unregister sqlite namespace: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit sqlite namespace deletion: %w", err)
	}
	return nil
}

func (s *SqliteStore) ListNamespaces(ctx context.Context, prefix string) ([]string, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("sqlite vector store is not initialized")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT namespace FROM `+sqliteNamespaceRegistry+` WHERE namespace LIKE ? ESCAPE '\' ORDER BY namespace`, escapeSqliteLike(prefix)+"%")
	if err != nil {
		return nil, fmt.Errorf("failed to list sqlite namespaces: %w", err)
	}
	defer rows.Close()
	namespaces := make([]string, 0)
	for rows.Next() {
		var namespace string
		if err := rows.Scan(&namespace); err != nil {
			return nil, fmt.Errorf("failed to scan sqlite namespace: %w", err)
		}
		namespaces = append(namespaces, namespace)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read sqlite namespaces: %w", err)
	}
	return namespaces, nil
}

func (s *SqliteStore) GetChunk(ctx context.Context, namespace string, id string) (SearchResult, error) {
	if strings.TrimSpace(id) == "" {
		return SearchResult{}, fmt.Errorf("id is required")
	}
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return SearchResult{}, err
	}
	var rawMetadata string
	err = s.db.QueryRowContext(ctx, `SELECT metadata FROM `+quoteSqliteIdentifier(table)+` WHERE id = ?`, id).Scan(&rawMetadata)
	if err == sql.ErrNoRows {
		return SearchResult{}, fmt.Errorf("not found: %s", id)
	}
	if err != nil {
		return SearchResult{}, fmt.Errorf("failed to get sqlite chunk: %w", err)
	}
	return sqliteResult(id, rawMetadata, nil)
}

func (s *SqliteStore) GetChunks(ctx context.Context, namespace string, ids []string) ([]SearchResult, error) {
	if len(ids) == 0 {
		return []SearchResult{}, nil
	}
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return nil, err
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, metadata FROM `+quoteSqliteIdentifier(table)+` WHERE id IN (`+strings.Join(placeholders, ",")+`) ORDER BY id`, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get sqlite chunks: %w", err)
	}
	defer rows.Close()
	return scanSqliteRows(rows, nil, false)
}

func (s *SqliteStore) GetAll(ctx context.Context, namespace string, queries []Query, selectFields []string, cursor *string, limit int64) ([]SearchResult, *string, error) {
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return nil, nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	where, args, err := buildSqliteFilter(queries)
	if err != nil {
		return nil, nil, err
	}
	if cursor != nil && *cursor != "" {
		where = append(where, "id > ?")
		args = append(args, *cursor)
	}
	args = append(args, limit)
	query := `SELECT id, metadata FROM ` + quoteSqliteIdentifier(table) + sqliteWhereClause(where) + ` ORDER BY id LIMIT ?`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list sqlite chunks: %w", err)
	}
	defer rows.Close()
	results, err := scanSqliteRows(rows, selectFields, false)
	if err != nil {
		return nil, nil, err
	}
	if int64(len(results)) < limit || len(results) == 0 {
		return results, nil, nil
	}
	next := results[len(results)-1].ID
	return results, &next, nil
}

func (s *SqliteStore) GetNearest(ctx context.Context, namespace string, vector []float32, queries []Query, selectFields []string, threshold float64, limit int64) ([]SearchResult, error) {
	if len(vector) == 0 {
		return nil, fmt.Errorf("vector is required")
	}
	if limit <= 0 {
		limit = 10
	}
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return nil, err
	}
	encoded, err := sqlite_vec.SerializeFloat32(vector)
	if err != nil {
		return nil, fmt.Errorf("failed to encode sqlite vector: %w", err)
	}
	where, args, err := buildSqliteFilter(queries)
	if err != nil {
		return nil, err
	}
	// vec_distance_cosine returns distance in [0,2]; the public score is
	// cosine similarity, matching every other backend.
	where = append(where, "1 - vec_distance_cosine(embedding, ?) >= ?")
	query := `SELECT id, metadata, 1 - vec_distance_cosine(embedding, ?) AS score FROM ` + quoteSqliteIdentifier(table) + sqliteWhereClause(where) + ` ORDER BY score DESC LIMIT ?`
	queryArgs := make([]any, 0, len(args)+4)
	queryArgs = append(queryArgs, encoded)
	queryArgs = append(queryArgs, args...)
	queryArgs = append(queryArgs, encoded, threshold, limit)
	rows, err := s.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to search sqlite chunks: %w", err)
	}
	defer rows.Close()
	return scanSqliteRows(rows, selectFields, true)
}

func (s *SqliteStore) Add(ctx context.Context, namespace string, id string, embedding []float32, metadata map[string]interface{}) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("id is required")
	}
	if len(embedding) == 0 {
		return fmt.Errorf("embedding is required for sqlite vectors")
	}
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return err
	}
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	encodedMetadata, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("failed to encode sqlite metadata: %w", err)
	}
	encodedEmbedding, err := sqlite_vec.SerializeFloat32(embedding)
	if err != nil {
		return fmt.Errorf("failed to encode sqlite vector: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO `+quoteSqliteIdentifier(table)+` (id, embedding, metadata) VALUES (?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET embedding = excluded.embedding, metadata = excluded.metadata`, id, encodedEmbedding, string(encodedMetadata))
	if err != nil {
		return fmt.Errorf("failed to upsert sqlite chunk: %w", err)
	}
	return nil
}

func (s *SqliteStore) Delete(ctx context.Context, namespace string, id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("id is required")
	}
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM `+quoteSqliteIdentifier(table)+` WHERE id = ?`, id); err != nil {
		return fmt.Errorf("failed to delete sqlite chunk: %w", err)
	}
	return nil
}

func (s *SqliteStore) DeleteAll(ctx context.Context, namespace string, queries []Query) ([]DeleteResult, error) {
	table, err := sqliteNamespaceTable(namespace)
	if err != nil {
		return nil, err
	}
	where, args, err := buildSqliteFilter(queries)
	if err != nil {
		return nil, err
	}
	query := `DELETE FROM ` + quoteSqliteIdentifier(table) + sqliteWhereClause(where) + ` RETURNING id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to delete sqlite chunks: %w", err)
	}
	defer rows.Close()
	results := make([]DeleteResult, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan deleted sqlite chunk: %w", err)
		}
		results = append(results, DeleteResult{ID: id, Status: DeleteStatusSuccess})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to delete sqlite chunks: %w", err)
	}
	return results, nil
}

func (s *SqliteStore) Close(_ context.Context, _ string) error {
	if s != nil && s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *SqliteStore) RequiresVectors() bool { return true }

func sqliteNamespaceTable(namespace string) (string, error) {
	if strings.TrimSpace(namespace) == "" {
		return "", fmt.Errorf("namespace is required")
	}
	sum := sha256.Sum256([]byte(namespace))
	return fmt.Sprintf("bifrost_vec_%x", sum[:16]), nil
}

func quoteSqliteIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func sqliteWhereClause(where []string) string {
	if len(where) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(where, " AND ")
}

func escapeSqliteLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	return strings.ReplaceAll(value, `_`, `\_`)
}

func sqliteResult(id, rawMetadata string, score *float64) (SearchResult, error) {
	properties := map[string]interface{}{}
	if rawMetadata != "" {
		if err := json.Unmarshal([]byte(rawMetadata), &properties); err != nil {
			return SearchResult{}, fmt.Errorf("failed to decode sqlite metadata: %w", err)
		}
	}
	return SearchResult{ID: id, Score: score, Properties: properties}, nil
}

func scanSqliteRows(rows *sql.Rows, selectFields []string, hasScore bool) ([]SearchResult, error) {
	results := make([]SearchResult, 0)
	for rows.Next() {
		var id, rawMetadata string
		var score *float64
		if hasScore {
			var value float64
			if err := rows.Scan(&id, &rawMetadata, &value); err != nil {
				return nil, fmt.Errorf("failed to scan sqlite result: %w", err)
			}
			score = &value
		} else if err := rows.Scan(&id, &rawMetadata); err != nil {
			return nil, fmt.Errorf("failed to scan sqlite result: %w", err)
		}
		result, err := sqliteResult(id, rawMetadata, score)
		if err != nil {
			return nil, err
		}
		result.Properties = filterProperties(result.Properties, selectFields)
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read sqlite results: %w", err)
	}
	return results, nil
}

func buildSqliteFilter(queries []Query) ([]string, []any, error) {
	where := make([]string, 0, len(queries))
	args := make([]any, 0, len(queries)*2)
	for _, query := range queries {
		if strings.TrimSpace(query.Field) == "" {
			return nil, nil, fmt.Errorf("sqlite query field is required")
		}
		path := sqliteJSONPath(query.Field)
		switch query.Operator {
		case QueryOperatorEqual:
			where = append(where, `json_extract(metadata, ?) = ?`)
			args = append(args, path, sqliteScalar(query.Value))
		case QueryOperatorNotEqual:
			where = append(where, `json_extract(metadata, ?) <> ?`)
			args = append(args, path, sqliteScalar(query.Value))
		case QueryOperatorGreaterThan, QueryOperatorLessThan, QueryOperatorGreaterThanOrEqual, QueryOperatorLessThanOrEqual:
			op := map[QueryOperator]string{QueryOperatorGreaterThan: ">", QueryOperatorLessThan: "<", QueryOperatorGreaterThanOrEqual: ">=", QueryOperatorLessThanOrEqual: "<="}[query.Operator]
			where = append(where, `CAST(json_extract(metadata, ?) AS REAL) `+op+` ?`)
			args = append(args, path, query.Value)
		case QueryOperatorLike:
			where = append(where, `lower(json_extract(metadata, ?)) LIKE lower(?)`)
			args = append(args, path, fmt.Sprint(query.Value))
		case QueryOperatorContainsAny, QueryOperatorContainsAll:
			values, ok := sqliteStringSlice(query.Value)
			if !ok {
				return nil, nil, fmt.Errorf("sqlite %s query requires a string list", query.Operator)
			}
			if len(values) == 0 {
				if query.Operator == QueryOperatorContainsAll {
					where = append(where, "1 = 1")
				} else {
					where = append(where, "1 = 0")
				}
				continue
			}
			placeholders := make([]string, len(values))
			matchArgs := make([]any, 0, len(values)+2)
			matchArgs = append(matchArgs, path)
			for i, value := range values {
				placeholders[i] = "?"
				matchArgs = append(matchArgs, value)
			}
			if query.Operator == QueryOperatorContainsAll {
				where = append(where, `(SELECT COUNT(DISTINCT value) FROM json_each(json_extract(metadata, ?)) WHERE value IN (`+strings.Join(placeholders, ",")+`)) = ?`)
				matchArgs = append(matchArgs, len(values))
			} else {
				where = append(where, `EXISTS (SELECT 1 FROM json_each(json_extract(metadata, ?)) WHERE value IN (`+strings.Join(placeholders, ",")+`))`)
			}
			args = append(args, matchArgs...)
		case QueryOperatorIsNull:
			where = append(where, `(json_extract(metadata, ?) IS NULL OR json_type(metadata, ?) = 'null')`)
			args = append(args, path, path)
		case QueryOperatorIsNotNull:
			where = append(where, `json_extract(metadata, ?) IS NOT NULL AND json_type(metadata, ?) <> 'null'`)
			args = append(args, path, path)
		default:
			return nil, nil, fmt.Errorf("unsupported sqlite query operator: %s", query.Operator)
		}
	}
	return where, args, nil
}

func sqliteJSONPath(field string) string {
	escaped := strings.ReplaceAll(field, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `$."` + escaped + `"`
}

func sqliteScalar(value any) any {
	switch typed := value.(type) {
	case bool:
		if typed {
			return 1
		}
		return 0
	case nil:
		return nil
	case string, int, int64, uint64, float32, float64:
		return typed
	default:
		return fmt.Sprint(value)
	}
}

func sqliteStringSlice(value any) ([]string, bool) {
	switch typed := value.(type) {
	case []string:
		return typed, true
	case []any:
		out := make([]string, len(typed))
		for i, item := range typed {
			out[i] = fmt.Sprint(item)
		}
		return out, true
	default:
		return nil, false
	}
}
