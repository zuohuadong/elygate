import type { BaseRecord, DataProvider, GetListParams, GetListResult, GetOneParams, GetOneResult } from '@svadmin/core';
import { createElysiaDataProvider, type ElysiaDataProviderOptions } from '@svadmin/elysia';

export type ParsedListResponse<T> = {
  readonly data: T[];
  readonly total: number;
};

export function parseDataListResponse<T>(json: unknown): ParsedListResponse<T> {
  if (Array.isArray(json)) return { data: json as T[], total: json.length };
  if (!json || typeof json !== 'object') return { data: [], total: 0 };

  const payload = json as { readonly data?: unknown; readonly total?: unknown };
  if (Array.isArray(payload.data)) {
    return {
      data: payload.data as T[],
      total: typeof payload.total === 'number' ? payload.total : payload.data.length,
    };
  }

  if (payload.data && typeof payload.data === 'object') {
    const nested = payload.data as { readonly data?: unknown; readonly total?: unknown };
    if (Array.isArray(nested.data)) {
      return {
        data: nested.data as T[],
        total: typeof nested.total === 'number' ? nested.total : nested.data.length,
      };
    }
  }

  return { data: [], total: 0 };
}

export type ElygateDataProviderOptions = Omit<ElysiaDataProviderOptions, 'parseListResponse'> & {
  readonly virtualResources?: ReadonlySet<string>;
  readonly fallbackGetOneFromList?: boolean;
  readonly parseListResponse?: ElysiaDataProviderOptions['parseListResponse'];
};

export function createElygateDataProvider(options: ElygateDataProviderOptions): DataProvider {
  const virtualResources = options.virtualResources ?? new Set<string>();
  const fallbackGetOneFromList = options.fallbackGetOneFromList ?? false;
  const baseDataProvider = createElysiaDataProvider({
    ...options,
    parseListResponse: options.parseListResponse ?? parseDataListResponse,
  });

  return {
    ...baseDataProvider,
    getList: async <TData extends BaseRecord = BaseRecord>(params: GetListParams): Promise<GetListResult<TData>> => {
      if (virtualResources.has(params.resource)) return { data: [], total: 0 };
      return baseDataProvider.getList<TData>(params);
    },
    getOne: async <TData extends BaseRecord = BaseRecord>(params: GetOneParams): Promise<GetOneResult<TData>> => {
      if (virtualResources.has(params.resource)) return { data: { id: params.id } as unknown as TData };
      if (!fallbackGetOneFromList) return baseDataProvider.getOne<TData>(params);

      try {
        return await baseDataProvider.getOne<TData>(params);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('404') && !message.includes('Not Found')) throw error;
        const list = await baseDataProvider.getList<TData>({
          resource: params.resource,
          pagination: { current: 1, pageSize: 1000 },
        });
        const found = list.data.find((item) => String(item.id) === String(params.id));
        if (found) return { data: found };
        throw error;
      }
    },
  };
}
