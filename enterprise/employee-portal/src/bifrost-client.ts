import { HttpError, jsonRecord, stringField, type FetchLike } from './http.ts';
import type { EmployeeIdentity, EmployeeUsage, EmployeeVirtualKey } from './types.ts';

type JsonRecord = Record<string, unknown>;

interface EmployeeAccess {
  readonly userId: string;
  readonly keys: EmployeeVirtualKey[];
}

function arrayPayload(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter((entry): entry is JsonRecord => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
  const record = jsonRecord(payload);
  for (const key of ['virtual_keys', 'keys', 'data', 'items']) {
    if (Array.isArray(record[key])) return arrayPayload(record[key]);
  }
  return [];
}

function maskKey(keyContent: string): string {
  if (!keyContent || keyContent === '<redacted>') return 'sk-bf-••••••••';
  if (keyContent.length <= 12) return '••••••••';
  return `${keyContent.slice(0, 8)}••••${keyContent.slice(-4)}`;
}

function keyView(record: JsonRecord): EmployeeVirtualKey {
  return {
    id: stringField(record, 'id'),
    name: stringField(record, 'name'),
    description: stringField(record, 'description'),
    isActive: record.is_active !== false,
    expiresAt: stringField(record, 'expires_at') || null,
    lastUsedAt: stringField(record, 'last_used_at') || null,
    maskedValue: maskKey(stringField(record, 'value')),
  };
}

export class BifrostEmployeeClient {
  constructor(
    private readonly baseUrl: URL,
    private readonly token: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = new URL(path.replace(/^\//, ''), `${this.baseUrl.toString().replace(/\/$/, '')}/`);
    const response = await this.fetcher(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
        authorization: `Bearer ${this.token}`,
      },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 404) throw new HttpError(404, '未找到当前员工或所请求的密钥');
      throw new HttpError(502, `Elygate 管理接口请求失败（HTTP ${response.status}）`);
    }
    return response.status === 204 ? null : response.json();
  }

  private async accessFor(identity: EmployeeIdentity): Promise<EmployeeAccess> {
    const payload = await this.request(`/api/users/email/${encodeURIComponent(identity.email)}/virtual-keys`);
    const response = jsonRecord(payload);
    const nestedResponse = jsonRecord(response.data);
    const userId = stringField(response, 'user_id') || stringField(nestedResponse, 'user_id');
    const keys = arrayPayload(payload).map(keyView).filter((key) => key.id);
    return { userId, keys };
  }

  async keysFor(identity: EmployeeIdentity): Promise<EmployeeVirtualKey[]> {
    return (await this.accessFor(identity)).keys;
  }

  async usageFor(identity: EmployeeIdentity, period: string): Promise<EmployeeUsage> {
    const acceptedPeriods = new Set(['1h', '24h', '7d', '30d']);
    if (!acceptedPeriods.has(period)) throw new HttpError(400, '不支持的统计周期');
    const { keys, userId } = await this.accessFor(identity);
    const keyIds = keys.map((key) => key.id);
    if (keyIds.length === 0) return { period, keyIds, dashboard: null };
    if (!userId) throw new HttpError(502, '员工 Key 映射缺少 Bifrost 用户 ID，无法安全查询用量');
    const query = new URLSearchParams({ period, virtual_key_ids: keyIds.join(','), user_ids: userId });
    const dashboard = await this.request(`/api/logs/dashboard?${query.toString()}`);
    return { period, keyIds, dashboard };
  }

  async rotate(identity: EmployeeIdentity, keyId: string): Promise<{ value: string; key: EmployeeVirtualKey }> {
    const payload = jsonRecord(await this.request(`/api/users/email/${encodeURIComponent(identity.email)}/virtual-keys/${encodeURIComponent(keyId)}/rotate`, { method: 'POST' }));
    const rotatedKey = jsonRecord(payload.virtual_key ?? payload.data ?? payload);
    const keyContent = stringField(rotatedKey, 'value');
    if (!keyContent) throw new HttpError(502, '密钥轮换成功，但服务端未返回新密钥值');
    const key = keyView(rotatedKey);
    if (!key.id || key.id !== keyId) throw new HttpError(502, '密钥轮换响应与请求不匹配');
    return { value: keyContent, key: { ...key, maskedValue: maskKey(keyContent) } };
  }
}
