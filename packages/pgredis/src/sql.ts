export interface PgSqlLike {
  unsafe<T = Record<string, unknown>>(query: string, params?: readonly unknown[]): Promise<T[]>;
  begin?<T>(callback: (tx: PgSqlLike) => Promise<T>): Promise<T>;
}

export function quoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${trimmed.replaceAll('"', '""')}"`;
}

export function quoteQualifiedName(name: string): string {
  const parts = name.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) {
    throw new Error(`Invalid SQL table name: ${name}`);
  }
  return parts.map(quoteIdentifier).join(".");
}

export function indexName(tableName: string, suffix: string): string {
  const normalized = tableName
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+/, "")
    .slice(0, 42) || "pg_redis_kit";
  return quoteIdentifier(`idx_${normalized}_${suffix}`.slice(0, 63));
}

export function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return Math.floor(value);
}
