import type { PgSqlLike } from "./sql";

export type PgAdvisoryLockKey = string | number | bigint | readonly [number, number];

export interface PgAdvisoryLockOptions {
  wait?: boolean;
  lockTimeoutMs?: number;
  transaction?: <T>(callback: (tx: PgSqlLike) => Promise<T>) => Promise<T>;
}

export class PgAdvisoryLockBusyError extends Error {
  readonly key: PgAdvisoryLockKey;

  constructor(key: PgAdvisoryLockKey) {
    super(`Postgres advisory lock is busy: ${String(key)}`);
    this.name = "PgAdvisoryLockBusyError";
    this.key = key;
  }
}

interface LockSqlArgs {
  expression: string;
  params: readonly unknown[];
}

function toInt32(value: number): number {
  return value | 0;
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return toInt32(hash);
}

export function advisoryLockKeyToSqlArgs(key: PgAdvisoryLockKey): LockSqlArgs {
  if (Array.isArray(key)) {
    return {
      expression: "$1::int, $2::int",
      params: [toInt32(key[0]), toInt32(key[1])]
    };
  }

  if (typeof key === "bigint") {
    return {
      expression: "$1::bigint",
      params: [key.toString()]
    };
  }

  if (typeof key === "number") {
    if (!Number.isSafeInteger(key)) throw new Error(`Invalid advisory lock number key: ${key}`);
    return {
      expression: "$1::bigint",
      params: [Math.trunc(key)]
    };
  }

  if (typeof key === "string") {
    return {
      expression: "$1::int, $2::int",
      params: [fnv1a32(key, 2166136261), fnv1a32(key, 2166136261 ^ 0x9e3779b9)]
    };
  }

  throw new Error("Invalid advisory lock key");
}

export async function withPgAdvisoryLock<T>(
  sql: PgSqlLike,
  key: PgAdvisoryLockKey,
  callback: (tx: PgSqlLike) => Promise<T>,
  options: PgAdvisoryLockOptions = {}
): Promise<T> {
  const runInTransaction = options.transaction ?? sql.begin?.bind(sql);
  if (!runInTransaction) {
    throw new Error("withPgAdvisoryLock requires a transaction-capable sql adapter");
  }

  return runInTransaction(async (tx) => {
    const args = advisoryLockKeyToSqlArgs(key);

    if (options.lockTimeoutMs !== undefined) {
      const timeoutMs = Math.max(1, Math.floor(options.lockTimeoutMs));
      await tx.unsafe("SELECT set_config('lock_timeout', $1, true)", [`${timeoutMs}ms`]);
    }

    if (options.wait === false) {
      const rows = await tx.unsafe<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(${args.expression}) AS locked`,
        args.params
      );
      if (!rows[0]?.locked) throw new PgAdvisoryLockBusyError(key);
    } else {
      await tx.unsafe(`SELECT pg_advisory_xact_lock(${args.expression})`, args.params);
    }

    return callback(tx);
  });
}

export class PgAdvisoryLocker {
  constructor(private readonly sql: PgSqlLike) {}

  withLock<T>(
    key: PgAdvisoryLockKey,
    callback: (tx: PgSqlLike) => Promise<T>,
    options?: PgAdvisoryLockOptions
  ): Promise<T> {
    return withPgAdvisoryLock(this.sql, key, callback, options);
  }
}

export function createPgAdvisoryLocker(sql: PgSqlLike): PgAdvisoryLocker {
  return new PgAdvisoryLocker(sql);
}
