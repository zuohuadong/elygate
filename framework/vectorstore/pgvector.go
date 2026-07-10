package vectorstore

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/maximhq/bifrost/core/schemas"
)

// PgvectorConfig configures a PostgreSQL database with the pgvector extension.
// The connection string accepts SecretVar references such as env.PGVECTOR_DSN.
type PgvectorConfig struct {
	ConnectionString schemas.SecretVar `json:"connection_string"`
	Schema           string            `json:"schema,omitempty"`
}

// PgvectorStore keeps each logical namespace in an internally derived table.
// Namespace values never become SQL identifiers, avoiding SQL injection and
// allowing cache keys to contain arbitrary application-level characters.
type PgvectorStore struct {
	pool   *pgxpool.Pool
	schema string
}

var pgvectorIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)

// ValidatePgvectorConfig validates persisted pgvector settings without opening a
// database connection. Management APIs use this before saving restart-bound
// configuration; runtime initialization performs the same validation before
// connecting.
func ValidatePgvectorConfig(config *PgvectorConfig, requireConnectionString bool) error {
	if config == nil {
		return fmt.Errorf("pgvector config is required")
	}
	if requireConnectionString && strings.TrimSpace(config.ConnectionString.GetValue()) == "" && !config.ConnectionString.IsFromSecret() {
		return fmt.Errorf("pgvector connection_string is required")
	}
	schema := config.Schema
	if schema == "" {
		schema = "bifrost_vectors"
	}
	if !pgvectorIdentifier.MatchString(schema) {
		return fmt.Errorf("pgvector schema must be a PostgreSQL identifier")
	}
	return nil
}

func newPgvectorStore(ctx context.Context, config *PgvectorConfig, _ schemas.Logger) (*PgvectorStore, error) {
	if err := ValidatePgvectorConfig(config, true); err != nil {
		return nil, err
	}
	schema := config.Schema
	if schema == "" {
		schema = "bifrost_vectors"
	}

	pool, err := pgxpool.New(ctx, config.ConnectionString.GetValue())
	if err != nil {
		return nil, fmt.Errorf("failed to create pgvector connection pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to connect to pgvector: %w", err)
	}
	var installed bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')`).Scan(&installed); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to check pgvector extension: %w", err)
	}
	if !installed {
		pool.Close()
		return nil, fmt.Errorf("pgvector extension is not installed; install the vector extension before enabling this vector store")
	}
	if _, err := pool.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS `+quotePgvectorIdentifier(schema)); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to create pgvector schema: %w", err)
	}
	return &PgvectorStore{pool: pool, schema: schema}, nil
}

func (s *PgvectorStore) Ping(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("pgvector store is not initialized")
	}
	return s.pool.Ping(ctx)
}

func (s *PgvectorStore) CreateNamespace(ctx context.Context, namespace string, dimension int, _ map[string]VectorStoreProperties) error {
	if dimension <= 0 {
		return fmt.Errorf("pgvector namespace dimension must be greater than 0")
	}
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return err
	}
	createTable := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
		id TEXT PRIMARY KEY,
		embedding vector(%d) NOT NULL,
		metadata JSONB NOT NULL DEFAULT '{}'::jsonb
	)`, table, dimension)
	if _, err := s.pool.Exec(ctx, createTable); err != nil {
		return fmt.Errorf("failed to create pgvector namespace: %w", err)
	}

	var existingDimension int
	err = s.pool.QueryRow(ctx, `SELECT a.atttypmod
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = $2 AND a.attname = 'embedding' AND NOT a.attisdropped`, s.schema, pgvectorTableName(namespace)).Scan(&existingDimension)
	if err != nil {
		return fmt.Errorf("failed to inspect pgvector namespace dimension: %w", err)
	}
	if existingDimension != dimension {
		return fmt.Errorf("namespace %q already exists with dimension %d but config requires %d; use a new vector_store_namespace or remove the existing namespace", namespace, existingDimension, dimension)
	}
	indexName := quotePgvectorIdentifier(pgvectorTableName(namespace) + "_embedding_hnsw")
	if _, err := s.pool.Exec(ctx, fmt.Sprintf(`CREATE INDEX IF NOT EXISTS %s ON %s USING hnsw (embedding vector_cosine_ops)`, indexName, table)); err != nil {
		return fmt.Errorf("failed to create pgvector HNSW index: %w", err)
	}
	metadataIndex := quotePgvectorIdentifier(pgvectorTableName(namespace) + "_metadata_gin")
	if _, err := s.pool.Exec(ctx, fmt.Sprintf(`CREATE INDEX IF NOT EXISTS %s ON %s USING gin (metadata)`, metadataIndex, table)); err != nil {
		return fmt.Errorf("failed to create pgvector metadata index: %w", err)
	}
	return nil
}

func (s *PgvectorStore) DeleteNamespace(ctx context.Context, namespace string) error {
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `DROP TABLE IF EXISTS `+table)
	if err != nil {
		return fmt.Errorf("failed to delete pgvector namespace: %w", err)
	}
	return nil
}

func (s *PgvectorStore) GetChunk(ctx context.Context, namespace string, id string) (SearchResult, error) {
	if strings.TrimSpace(id) == "" {
		return SearchResult{}, fmt.Errorf("id is required")
	}
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return SearchResult{}, err
	}
	result, err := scanPgvectorResult(s.pool.QueryRow(ctx, `SELECT id, metadata FROM `+table+` WHERE id = $1`, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return SearchResult{}, fmt.Errorf("not found: %s", id)
		}
		return SearchResult{}, fmt.Errorf("failed to get pgvector chunk: %w", err)
	}
	return result, nil
}

func (s *PgvectorStore) GetChunks(ctx context.Context, namespace string, ids []string) ([]SearchResult, error) {
	if len(ids) == 0 {
		return []SearchResult{}, nil
	}
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id, metadata FROM `+table+` WHERE id = ANY($1::text[]) ORDER BY id`, ids)
	if err != nil {
		return nil, fmt.Errorf("failed to get pgvector chunks: %w", err)
	}
	defer rows.Close()
	return scanPgvectorRows(rows, nil)
}

func (s *PgvectorStore) GetAll(ctx context.Context, namespace string, queries []Query, selectFields []string, cursor *string, limit int64) ([]SearchResult, *string, error) {
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return nil, nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	where, args, err := buildPgvectorFilter(queries, 1)
	if err != nil {
		return nil, nil, err
	}
	if cursor != nil && *cursor != "" {
		where = append(where, fmt.Sprintf("id > $%d", len(args)+1))
		args = append(args, *cursor)
	}
	args = append(args, limit)
	query := `SELECT id, metadata FROM ` + table + pgvectorWhereClause(where) + fmt.Sprintf(" ORDER BY id LIMIT $%d", len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list pgvector chunks: %w", err)
	}
	defer rows.Close()
	results, err := scanPgvectorRows(rows, selectFields)
	if err != nil {
		return nil, nil, err
	}
	if int64(len(results)) < limit || len(results) == 0 {
		return results, nil, nil
	}
	next := results[len(results)-1].ID
	return results, &next, nil
}

func (s *PgvectorStore) GetNearest(ctx context.Context, namespace string, vector []float32, queries []Query, selectFields []string, threshold float64, limit int64) ([]SearchResult, error) {
	if len(vector) == 0 {
		return nil, fmt.Errorf("vector is required")
	}
	if limit <= 0 {
		limit = 10
	}
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return nil, err
	}
	where, args, err := buildPgvectorFilter(queries, 2)
	if err != nil {
		return nil, err
	}
	where = append(where, "1 - (embedding <=> $1::vector) >= $"+strconv.Itoa(len(args)+2))
	args = append([]any{pgvectorLiteral(vector)}, args...)
	args = append(args, threshold, limit)
	query := `SELECT id, metadata, 1 - (embedding <=> $1::vector) AS score FROM ` + table + pgvectorWhereClause(where) + fmt.Sprintf(" ORDER BY embedding <=> $1::vector ASC LIMIT $%d", len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to search pgvector chunks: %w", err)
	}
	defer rows.Close()
	return scanPgvectorRows(rows, selectFields)
}

func (s *PgvectorStore) Add(ctx context.Context, namespace string, id string, embedding []float32, metadata map[string]interface{}) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("id is required")
	}
	if len(embedding) == 0 {
		return fmt.Errorf("embedding is required for pgvector")
	}
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return err
	}
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("failed to encode pgvector metadata: %w", err)
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO `+table+` (id, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb)
		ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`, id, pgvectorLiteral(embedding), string(encoded))
	if err != nil {
		return fmt.Errorf("failed to upsert pgvector chunk: %w", err)
	}
	return nil
}

func (s *PgvectorStore) Delete(ctx context.Context, namespace string, id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("id is required")
	}
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM `+table+` WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete pgvector chunk: %w", err)
	}
	return nil
}

func (s *PgvectorStore) DeleteAll(ctx context.Context, namespace string, queries []Query) ([]DeleteResult, error) {
	table, err := s.qualifiedTable(namespace)
	if err != nil {
		return nil, err
	}
	where, args, err := buildPgvectorFilter(queries, 1)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `DELETE FROM `+table+pgvectorWhereClause(where)+` RETURNING id`, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to delete pgvector chunks: %w", err)
	}
	defer rows.Close()
	results := make([]DeleteResult, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan deleted pgvector chunk: %w", err)
		}
		results = append(results, DeleteResult{ID: id, Status: DeleteStatusSuccess})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to delete pgvector chunks: %w", err)
	}
	return results, nil
}

func (s *PgvectorStore) Close(_ context.Context, _ string) error {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
	return nil
}

func (s *PgvectorStore) RequiresVectors() bool { return true }

func (s *PgvectorStore) qualifiedTable(namespace string) (string, error) {
	table, err := pgvectorNamespaceTable(namespace)
	if err != nil {
		return "", err
	}
	return quotePgvectorIdentifier(s.schema) + "." + quotePgvectorIdentifier(table), nil
}

func pgvectorNamespaceTable(namespace string) (string, error) {
	if strings.TrimSpace(namespace) == "" {
		return "", fmt.Errorf("namespace is required")
	}
	sum := sha256.Sum256([]byte(namespace))
	return fmt.Sprintf("bifrost_vec_%x", sum[:16]), nil
}

func pgvectorTableName(namespace string) string {
	table, _ := pgvectorNamespaceTable(namespace)
	return table
}

func quotePgvectorIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func pgvectorWhereClause(where []string) string {
	if len(where) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(where, " AND ")
}

func pgvectorLiteral(vector []float32) string {
	values := make([]string, len(vector))
	for i, value := range vector {
		values[i] = strconv.FormatFloat(float64(value), 'f', -1, 32)
	}
	return "[" + strings.Join(values, ",") + "]"
}

func scanPgvectorResult(row pgx.Row) (SearchResult, error) {
	var id string
	var rawMetadata []byte
	if err := row.Scan(&id, &rawMetadata); err != nil {
		return SearchResult{}, err
	}
	properties := map[string]interface{}{}
	if err := json.Unmarshal(rawMetadata, &properties); err != nil {
		return SearchResult{}, fmt.Errorf("failed to decode pgvector metadata: %w", err)
	}
	return SearchResult{ID: id, Properties: properties}, nil
}

func scanPgvectorRows(rows pgx.Rows, selectFields []string) ([]SearchResult, error) {
	results := make([]SearchResult, 0)
	for rows.Next() {
		var id string
		var rawMetadata []byte
		var score *float64
		if len(rows.FieldDescriptions()) == 3 {
			var value float64
			if err := rows.Scan(&id, &rawMetadata, &value); err != nil {
				return nil, fmt.Errorf("failed to scan pgvector result: %w", err)
			}
			score = &value
		} else if err := rows.Scan(&id, &rawMetadata); err != nil {
			return nil, fmt.Errorf("failed to scan pgvector result: %w", err)
		}
		properties := map[string]interface{}{}
		if err := json.Unmarshal(rawMetadata, &properties); err != nil {
			return nil, fmt.Errorf("failed to decode pgvector metadata: %w", err)
		}
		results = append(results, SearchResult{ID: id, Score: score, Properties: filterProperties(properties, selectFields)})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read pgvector results: %w", err)
	}
	return results, nil
}

func buildPgvectorFilter(queries []Query, start int) ([]string, []any, error) {
	where := make([]string, 0, len(queries))
	args := make([]any, 0, len(queries)*2)
	placeholder := start
	next := func(value any) string {
		args = append(args, value)
		result := "$" + strconv.Itoa(placeholder)
		placeholder++
		return result
	}
	for _, query := range queries {
		if strings.TrimSpace(query.Field) == "" {
			return nil, nil, fmt.Errorf("pgvector query field is required")
		}
		field := next(query.Field)
		switch query.Operator {
		case QueryOperatorEqual:
			where = append(where, "metadata ->> "+field+" = "+next(fmt.Sprint(query.Value)))
		case QueryOperatorNotEqual:
			where = append(where, "metadata ->> "+field+" <> "+next(fmt.Sprint(query.Value)))
		case QueryOperatorGreaterThan, QueryOperatorLessThan, QueryOperatorGreaterThanOrEqual, QueryOperatorLessThanOrEqual:
			op := map[QueryOperator]string{QueryOperatorGreaterThan: ">", QueryOperatorLessThan: "<", QueryOperatorGreaterThanOrEqual: ">=", QueryOperatorLessThanOrEqual: "<="}[query.Operator]
			where = append(where, "(metadata ->> "+field+")::numeric "+op+" "+next(query.Value))
		case QueryOperatorLike:
			where = append(where, "metadata ->> "+field+" ILIKE "+next(fmt.Sprint(query.Value)))
		case QueryOperatorContainsAny:
			encoded, err := json.Marshal(query.Value)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to encode ContainsAny query: %w", err)
			}
			where = append(where, "metadata -> "+field+" ?| ARRAY(SELECT jsonb_array_elements_text("+next(string(encoded))+"::jsonb))")
		case QueryOperatorContainsAll:
			encoded, err := json.Marshal(query.Value)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to encode ContainsAll query: %w", err)
			}
			where = append(where, "metadata -> "+field+" @> "+next(string(encoded))+"::jsonb")
		case QueryOperatorIsNull:
			where = append(where, "(NOT (metadata ? "+field+") OR metadata -> "+field+" = 'null'::jsonb)")
		case QueryOperatorIsNotNull:
			where = append(where, "metadata ? "+field+" AND metadata -> "+field+" <> 'null'::jsonb")
		default:
			return nil, nil, fmt.Errorf("unsupported pgvector query operator: %s", query.Operator)
		}
	}
	return where, args, nil
}
