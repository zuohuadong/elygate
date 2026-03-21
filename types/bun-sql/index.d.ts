/**
 * Type declarations for bun:sql — Bun's built-in PostgreSQL client.
 * This is an experimental API (Bun 1.2+), types are not yet in @types/bun or bun-types.
 * @see https://bun.sh/docs/api/sql
 */
declare module "bun:sql" {
    interface SQLPoolConfig {
        max?: number;
        idle_timeout?: number;
        connect_timeout?: number;
        max_lifetime?: number;
        max_pipeline?: number;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface SQLQuery extends Promise<any[]> {
        values(): Promise<unknown[][]>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        raw(): Promise<any[]>;
        count: number;
    }

    interface SQLInstance {
        /** Tagged template literal for SQL queries */
        (strings: TemplateStringsArray, ...values: unknown[]): SQLQuery;
        /** Helper to embed arrays/values in SQL queries (e.g. `WHERE id IN ${sql(ids)}`) */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (values: any): SQLQuery;
        /** Execute an unsafe raw SQL query string */
        unsafe(query: string, params?: unknown[]): SQLQuery;

        /**
         * Begin a transaction. The callback receives a transaction-scoped SQL instance.
         * Automatically sends BEGIN, COMMIT on success, ROLLBACK on error.
         * @see https://bun.sh/docs/api/sql#transactions
         */
        begin<T>(fn: (tx: SQLInstance) => Promise<T> | SQLQuery[]): Promise<T>;
        begin<T>(options: string, fn: (tx: SQLInstance) => Promise<T> | SQLQuery[]): Promise<T>;

        /**
         * Create a savepoint within a transaction for partial rollback.
         * @see https://bun.sh/docs/api/sql#savepoints
         */
        savepoint<T>(fn: (sp: SQLInstance) => Promise<T>): Promise<T>;
        savepoint<T>(name: string, fn: (sp: SQLInstance) => Promise<T>): Promise<T>;

        /**
         * Begin a distributed (two-phase commit) transaction.
         * @see https://bun.sh/docs/api/sql#distributed-transactions
         */
        beginDistributed<T>(id: string, fn: (tx: SQLInstance) => Promise<T>): Promise<T>;
        /** Commit a previously prepared distributed transaction */
        commitDistributed(id: string): Promise<void>;
        /** Rollback a previously prepared distributed transaction */
        rollbackDistributed(id: string): Promise<void>;

        /** Close all connections in the pool */
        close(): void;
        /** Reserve a dedicated connection from the pool */
        reserve(): Promise<SQLInstance>;
    }

    interface SQLConstructor {
        new (url?: string, config?: SQLPoolConfig): SQLInstance;
        (strings: TemplateStringsArray, ...values: unknown[]): SQLQuery;
    }

    export const SQL: SQLConstructor;
    const sql: SQLInstance;
    export default sql;
    export { sql };
    export type { SQLInstance, SQLQuery, SQLPoolConfig };
}
