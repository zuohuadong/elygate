import { createPgListener } from "@elygate/pg-listen";
import type { PgSqlLike } from "./sql";

export { createPgListener };
export type {
  NotifyHandler,
  PgListenerEvents,
  PgListenerHandle,
  PgListenerHealth,
  PgListenerOptions
} from "@elygate/pg-listen";

export type PgNotifyPayload = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface PgPublisher {
  publish(channel: string, payload: PgNotifyPayload): Promise<void>;
}

function serializePayload(payload: PgNotifyPayload): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export async function publishPgNotify(sql: PgSqlLike, channel: string, payload: PgNotifyPayload): Promise<void> {
  await sql.unsafe("SELECT pg_notify($1, $2)", [channel, serializePayload(payload)]);
}

export function createPgPublisher(sql: PgSqlLike): PgPublisher {
  return {
    publish(channel, payload) {
      return publishPgNotify(sql, channel, payload);
    }
  };
}
