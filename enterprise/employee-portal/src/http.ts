export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function jsonRecord(candidate: unknown): Record<string, unknown> {
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : {};
}

export function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : '';
}
