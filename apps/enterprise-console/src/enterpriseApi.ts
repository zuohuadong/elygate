import { getSupAuthHeaders } from './providers/auth';

export type EnterpriseApiState<T> = {
  loading: boolean;
  data: T | null;
  error: string | null;
};

export function createEnterpriseApiState<T>(): EnterpriseApiState<T> {
  return {
    loading: true,
    data: null,
    error: null,
  };
}

export async function enterpriseApiGet<T>(path: string): Promise<T> {
  return enterpriseApiRequest<T>(path);
}

export async function enterpriseApiPost<T>(path: string, body: unknown): Promise<T> {
  return enterpriseApiRequest<T>(path, {
    method: 'POST',
    body,
  });
}

export async function enterpriseApiPut<T>(path: string, body: unknown): Promise<T> {
  return enterpriseApiRequest<T>(path, {
    method: 'PUT',
    body,
  });
}

async function enterpriseApiRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...getSupAuthHeaders(),
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`/api/enterprise${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'include',
  });
  const json = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = json && typeof json === 'object' && 'message' in json ? String((json as { message?: unknown }).message) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}
