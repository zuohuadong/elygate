import type {
	BaseRecord,
	CreateParams,
	DataProvider,
	DeleteParams,
	GetListParams,
	GetOneParams,
	UpdateParams,
} from '@svadmin/core';
import { encodePathSegment, getListPayload, getObjectPayload, getTotal, requestJson, type JsonRecord } from './api';

function listPath(resource: string, params: GetListParams): string {
	const query = new URLSearchParams();
	const pagination = params.pagination;
	if (pagination?.mode !== 'off') {
		if (pagination?.pageSize) query.set('limit', String(pagination.pageSize));
		if (pagination?.current && pagination.pageSize) query.set('offset', String((pagination.current - 1) * pagination.pageSize));
	}
	const filters = params.filters?.filter((filter) => 'field' in filter && filter.operator === 'eq');
	for (const filter of filters ?? []) {
		if ('field' in filter && filter.value !== undefined) query.set(filter.field, String(filter.value));
	}
	const suffix = query.toString();
	if (resource === 'providers') return `/api/providers${suffix ? `?${suffix}` : ''}`;
	if (resource === 'virtual-keys') return `/api/governance/virtual-keys${suffix ? `?${suffix}` : ''}`;
	if (resource === 'models') {
		if (!query.has('limit')) query.set('limit', '0');
		return `/api/models?${query.toString()}`;
	}
	if (resource === 'logs') return `/api/logs${suffix ? `?${suffix}` : '?limit=50'}`;
	throw new Error(`Unsupported Elygate resource: ${resource}`);
}

function listResponse(resource: string, payload: unknown): { data: JsonRecord[]; total: number } {
	const data = getListPayload(payload);
	return { data, total: getTotal(payload, data.length) };
}

function unwrapMutation(resource: string, payload: unknown): JsonRecord {
	if (resource === 'virtual-keys') return getObjectPayload(payload, 'virtual_key');
	return getObjectPayload(payload, 'data');
}

export const bifrostDataProvider: DataProvider = {
	getList: async <TData extends BaseRecord>(params: GetListParams) => {
		const payload = await requestJson<unknown>(listPath(params.resource, params));
		const result = listResponse(params.resource, payload);
		return result as { data: TData[]; total: number };
	},
	getOne: async <TData extends BaseRecord>(params: GetOneParams) => {
		let path: string;
		if (params.resource === 'providers') path = `/api/providers/${encodePathSegment(params.id)}`;
		else if (params.resource === 'virtual-keys') path = `/api/governance/virtual-keys/${encodePathSegment(params.id)}`;
		else throw new Error(`Unsupported getOne resource: ${params.resource}`);
		const payload = await requestJson<unknown>(path);
		const data = params.resource === 'virtual-keys' ? getObjectPayload(payload, 'virtual_key') : getObjectPayload(payload, 'data');
		return { data: data as TData };
	},
	create: async <TData extends BaseRecord, TVariables>(params: CreateParams<TVariables>) => {
		let path: string;
		if (params.resource === 'providers') path = '/api/providers';
		else if (params.resource === 'virtual-keys') path = '/api/governance/virtual-keys';
		else throw new Error(`Unsupported create resource: ${params.resource}`);
		const payload = await requestJson<unknown>(path, { method: 'POST', body: JSON.stringify(params.variables) });
		return { data: unwrapMutation(params.resource, payload) as TData };
	},
	update: async <TData extends BaseRecord, TVariables>(params: UpdateParams<TVariables>) => {
		let path: string;
		if (params.resource === 'providers') path = `/api/providers/${encodePathSegment(params.id)}`;
		else if (params.resource === 'virtual-keys') path = `/api/governance/virtual-keys/${encodePathSegment(params.id)}`;
		else throw new Error(`Unsupported update resource: ${params.resource}`);
		const payload = await requestJson<unknown>(path, { method: 'PUT', body: JSON.stringify(params.variables) });
		return { data: unwrapMutation(params.resource, payload) as TData };
	},
	deleteOne: async <TData extends BaseRecord, TVariables>(params: DeleteParams<TVariables>) => {
		let path: string;
		if (params.resource === 'providers') path = `/api/providers/${encodePathSegment(params.id)}`;
		else if (params.resource === 'virtual-keys') path = `/api/governance/virtual-keys/${encodePathSegment(params.id)}`;
		else throw new Error(`Unsupported delete resource: ${params.resource}`);
		const payload = await requestJson<unknown>(path, { method: 'DELETE' });
		return { data: getObjectPayload(payload, 'data') as TData };
	},
	getApiUrl: () => '/api',
};
