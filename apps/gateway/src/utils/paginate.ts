/**
 * Parse pagination, sorting, and filter parameters from query string.
 * Compatible with svadmin DataProvider conventions:
 *   ?_page=1&_limit=10&_sort=id&_order=desc&field=value&field_like=value
 *
 * Also supports legacy elygate params: ?page=1&limit=50
 *
 * When `_page` or `_limit` is explicitly present, `isPaginated = true`,
 * and `formatResponse()` returns `{ data, total, page, limit }`.
 * Otherwise it returns the raw array for backward compatibility.
 */
export interface PaginatedParams {
    page: number;
    limit: number;
    offset: number;
    isPaginated: boolean;
    sort?: { field: string; order: 'ASC' | 'DESC' };
    filters: Record<string, string>;
}

export function parsePaginationParams(query: Record<string, any>): PaginatedParams {
    const isPaginated = query?._page !== undefined || query?._limit !== undefined;
    const page = Number(query?._page ?? query?.page) || 1;
    const limit = Math.min(Number(query?._limit ?? query?.limit) || 50, 500);
    const offset = (page - 1) * limit;

    let sort: PaginatedParams['sort'] = undefined;
    const sortField = query?._sort;
    if (sortField && /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(sortField)) {
        const order = (query?._order || 'desc').toUpperCase();
        sort = { field: sortField, order: order === 'ASC' ? 'ASC' : 'DESC' };
    }

    // Extract filter params (exclude pagination/sort meta params)
    const metaKeys = new Set(['_page', '_limit', '_sort', '_order', 'page', 'limit', 'format', 'lang']);
    const filters: Record<string, string> = {};
    if (query) {
        for (const [key, val] of Object.entries(query)) {
            if (!metaKeys.has(key) && val !== undefined && val !== '') {
                filters[key] = String(val);
            }
        }
    }

    return { page, limit, offset, isPaginated, sort, filters };
}

/**
 * Format a list response.
 * When svadmin pagination params are present → { data, total, page, limit }
 * Otherwise → raw array (backward compatible with existing frontend)
 */
export function formatListResponse<T>(
    data: T[],
    total: number,
    params: PaginatedParams
): T[] | { data: T[]; total: number; page: number; limit: number } {
    if (params.isPaginated) {
        return { data, total, page: params.page, limit: params.limit };
    }
    return data;
}
