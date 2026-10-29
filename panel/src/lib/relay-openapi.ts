import { isJsonRecord, type JsonRecord } from './api';
import type { RelayAuthType, RelayDraft } from './relay-management';

export const relayOpenApiMaxBytes = 5 * 1024 * 1024;
const routeMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

interface AuthSuggestion {
	type: RelayAuthType;
	headerName?: string;
	queryParam?: string;
}
export interface ImportedRelayRoute extends JsonRecord {
	method: string;
	path: string;
	headers?: Record<string, string>;
}
export interface RelayOpenApiWarning {
	code: 'reference' | 'operation' | 'auth' | 'server' | 'server-query' | 'operation-server' | 'duplicate';
	subject: string;
}
export interface RelayOpenApiImport {
	title: string;
	version: string;
	baseUrl?: string;
	auth?: AuthSuggestion;
	routes: ImportedRelayRoute[];
	warnings: RelayOpenApiWarning[];
}
export interface RelayImportReview {
	routes: ImportedRelayRoute[];
	removed: ImportedRelayRoute[];
	preserved: number;
}

export function checkRelaySpecSize(source: string): void {
	if (!source.trim()) throw new Error('openapi-empty');
	if (new TextEncoder().encode(source).byteLength > relayOpenApiMaxBytes) throw new Error('openapi-too-large');
}

export async function parseRelayOpenApi(source: string, documentUrl?: string): Promise<RelayOpenApiImport> {
	checkRelaySpecSize(source);
	const { parseDocument } = await import('yaml');
	const parsed = parseDocument(source, { uniqueKeys: true, prettyErrors: false, strict: true, schema: 'core' });
	if (parsed.errors.length || parsed.warnings.length) throw new Error('openapi-invalid-document');
	let document: unknown;
	try { document = parsed.toJS({ maxAliasCount: 50 }); }
	catch { throw new Error('openapi-invalid-document'); }
	if (!isJsonRecord(document)) throw new Error('openapi-object');
	if (document.swagger === 2) document.swagger = '2.0';
	if (document.swagger !== '2.0' && !(typeof document.openapi === 'string' && /^3\.[012]\.\d+$/.test(document.openapi))) throw new Error('openapi-version');
	return importRelayOperations(document, documentUrl);
}

function recordOrEmpty(candidate: unknown): JsonRecord {
	return isJsonRecord(candidate) ? candidate : {};
}
function stringOrEmpty(candidate: unknown): string {
	return typeof candidate === 'string' ? candidate : '';
}

// Only in-document pointers are followed. External references never bypass the gateway fetch guard.
function resolveReference(document: JsonRecord, candidate: unknown): JsonRecord | undefined {
	const visited = new Set<string>();
	while (isJsonRecord(candidate) && typeof candidate.$ref === 'string') {
		const pointer = candidate.$ref;
		if (!pointer.startsWith('#/') || visited.has(pointer) || visited.size >= 32) return undefined;
		visited.add(pointer);
		let tokens: string[];
		try { tokens = decodeURIComponent(pointer.slice(2)).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~')); }
		catch { return undefined; }
		candidate = document;
		for (const token of tokens) candidate = isJsonRecord(candidate) && Object.hasOwn(candidate, token) ? candidate[token] : undefined;
	}
	return isJsonRecord(candidate) ? candidate : undefined;
}

function escapeGlob(literal: string): string {
	return literal.replace(/[*?[\]\\]/g, '\\$&');
}
function decodedLiteral(literal: string): string {
	try { return decodeURIComponent(literal); }
	catch { return literal; }
}

function routeFromTemplate(template: string, method: string): ImportedRelayRoute {
	const [pathname, ...fragments] = template.split('#');
	if (!pathname.startsWith('/') || pathname.includes('?')) throw new Error('openapi-path');
	const path = pathname.split('/').map(segment => {
		const pieces = segment.split(/\{[^{}]+\}/);
		if (pieces.some(piece => /[{}]/.test(piece))) throw new Error('openapi-path');
		return pieces.filter((piece, index) => index === 0 || index === pieces.length - 1 || piece !== '').map(piece => escapeGlob(decodedLiteral(piece))).join('*');
	}).join('/');
	if (!fragments.length) return { method, path };
	const fragment = fragments.join('#');
	const separator = fragment.indexOf('=');
	const header = fragment.slice(0, separator);
	if (separator <= 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header)) throw new Error('openapi-path');
	return { method, path, headers: { [header]: escapeGlob(fragment.slice(separator + 1)) } };
}

function routeOrder(route: ImportedRelayRoute): number[] {
	const literals = route.path.replace(/\\./g, 'x');
	const wildcards = (literals.match(/\*/g) ?? []).length;
	return [wildcards ? 1 : 0, wildcards ? literals.split('/').length : 0, wildcards ? -literals.replace(/\*/g, '').length : 0, wildcards];
}
function compareImportedRoutes(left: ImportedRelayRoute, right: ImportedRelayRoute): number {
	const leftRank = routeOrder(left), rightRank = routeOrder(right);
	for (let index = 0; index < leftRank.length; index += 1) if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index];
	if (left.path !== right.path) return left.path < right.path ? -1 : 1;
	const headerCount = Object.keys(right.headers ?? {}).length - Object.keys(left.headers ?? {}).length;
	if (headerCount) return headerCount;
	const leftMethod = left.method.toUpperCase(), rightMethod = right.method.toUpperCase();
	if (leftMethod !== rightMethod) return leftMethod < rightMethod ? -1 : 1;
	const leftIdentity = routeIdentity(left), rightIdentity = routeIdentity(right);
	return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
}
function routeIdentity(route: ImportedRelayRoute): string {
	const headers = Object.entries(route.headers ?? {}).map(([name, matcher]) => [name.toLowerCase(), matcher]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
	return JSON.stringify([route.method.toUpperCase(), route.path, headers]);
}

function mappedAuth(scheme: JsonRecord): AuthSuggestion | undefined {
	const schemeType = typeof scheme.type === 'string' ? scheme.type.toLowerCase() : '';
	const location = typeof scheme.in === 'string' ? scheme.in.toLowerCase() : '';
	if (schemeType === 'apikey' && typeof scheme.name === 'string' && scheme.name.trim()) {
		if (location === 'header') return { type: 'header', headerName: scheme.name };
		if (location === 'query') return { type: 'query', queryParam: scheme.name };
	}
	if (schemeType === 'basic') return { type: 'basic' };
	const httpScheme = typeof scheme.scheme === 'string' ? scheme.scheme.toLowerCase() : '';
	if (schemeType === 'http' && (httpScheme === 'bearer' || httpScheme === 'basic')) return { type: httpScheme };
	return undefined;
}

function authForOperation(document: JsonRecord, requirement: unknown): { auth?: AuthSuggestion; ambiguous?: boolean } {
	const schemes = recordOrEmpty(recordOrEmpty(document.components).securitySchemes ?? document.securityDefinitions);
	if (requirement === undefined) return {};
	if (!Array.isArray(requirement)) return { ambiguous: true };
	if (!requirement.length || requirement.some(alternative => isJsonRecord(alternative) && !Object.keys(alternative).length)) return {};
	const candidates: AuthSuggestion[] = [];
	for (const alternative of requirement) {
		if (!isJsonRecord(alternative) || Object.keys(alternative).length !== 1) continue;
		const scheme = resolveReference(document, schemes[Object.keys(alternative)[0]]);
		const auth = scheme && mappedAuth(scheme);
		if (auth) candidates.push(auth);
	}
	if (!candidates.length) return { ambiguous: true };
	const first = JSON.stringify(candidates[0]);
	return candidates.every(candidate => JSON.stringify(candidate) === first) ? { auth: candidates[0] } : { ambiguous: true };
}

function authSuggestion(document: JsonRecord, requirements: unknown[], warnings: RelayOpenApiWarning[]): AuthSuggestion | undefined {
	const candidates = requirements.map(requirement => authForOperation(document, requirement));
	const required = candidates.filter(candidate => candidate.auth);
	if (candidates.some(candidate => candidate.ambiguous)
		|| (required.length > 0 && required.length !== candidates.length)
		|| required.some(candidate => JSON.stringify(candidate.auth) !== JSON.stringify(required[0]?.auth))) {
		warnings.push({ code: 'auth', subject: '' });
		return undefined;
	}
	return required[0]?.auth;
}

function resolveServerUrl(candidate: string, documentUrl?: string, rejectFragment = false): { baseUrl: string; droppedQuery: boolean } | undefined {
	try {
		const parsed = documentUrl ? new URL(candidate, documentUrl) : new URL(candidate);
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || (rejectFragment && parsed.hash)) return undefined;
		return { baseUrl: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ''), droppedQuery: Boolean(parsed.search) };
	} catch { return undefined; }
}
function expandedServer(server: unknown): string {
	const config = recordOrEmpty(server);
	const variables = recordOrEmpty(config.variables);
	return stringOrEmpty(config.url).replace(/\{([^{}]+)\}/g, (token, name: string) => {
		const fallback = recordOrEmpty(variables[name]).default;
		return typeof fallback === 'string' ? fallback : token;
	});
}
function swaggerServerCandidate(document: JsonRecord, documentUrl?: string): string | undefined {
	if (document.swagger === '2.0') {
		const schemes = Array.isArray(document.schemes) ? document.schemes : [];
		const supportedSchemes = schemes.filter((scheme): scheme is string => scheme === 'http' || scheme === 'https');
		const scheme = supportedSchemes.includes('https') ? 'https' : supportedSchemes[0] ?? (!document.host && documentUrl ? new URL(documentUrl).protocol.slice(0, -1) : 'https');
		return document.host ? `${scheme}://${document.host}${stringOrEmpty(document.basePath)}` : documentUrl ? `${scheme}://${new URL(documentUrl).host}${stringOrEmpty(document.basePath) || '/'}` : undefined;
	}
	return undefined;
}
function suggestedBaseUrl(document: JsonRecord, documentUrl: string | undefined, warnings: RelayOpenApiWarning[]): string | undefined {
	const servers = Array.isArray(document.servers) ? document.servers : [];
	const candidates = document.swagger === '2.0'
		? [swaggerServerCandidate(document, documentUrl)]
		: (servers.length ? servers.map(expandedServer) : documentUrl ? ['/'] : []);
	for (const candidate of candidates) {
		if (!candidate || candidate.includes('{')) continue;
		const resolved = resolveServerUrl(candidate, documentUrl);
		if (!resolved) continue;
		if (resolved.droppedQuery) warnings.push({ code: 'server-query', subject: '' });
		return resolved.baseUrl;
	}
	warnings.push({ code: 'server', subject: '' });
	return undefined;
}

function collectOperations(document: JsonRecord, warnings: RelayOpenApiWarning[]): { routes: ImportedRelayRoute[]; requirements: unknown[] } {
	const routes: ImportedRelayRoute[] = [], requirements: unknown[] = [];
	for (const [template, pathDefinition] of Object.entries(recordOrEmpty(document.paths))) {
		const pathItem = resolveReference(document, pathDefinition);
		if (!pathItem) { warnings.push({ code: 'reference', subject: template }); continue; }
		for (const [method, definition] of Object.entries(pathItem)) {
			if (!routeMethods.includes(method.toUpperCase())) {
				if (['options', 'trace', 'query', 'additionalOperations'].includes(method)) warnings.push({ code: 'operation', subject: `${method.toUpperCase()} ${template}` });
				continue;
			}
			const operation = resolveReference(document, definition);
			if (!operation) { warnings.push({ code: 'operation', subject: `${method.toUpperCase()} ${template}` }); continue; }
			try { routes.push(routeFromTemplate(template, method.toUpperCase())); }
			catch { warnings.push({ code: 'operation', subject: `${method.toUpperCase()} ${template}` }); continue; }
			requirements.push(Object.hasOwn(operation, 'security') ? operation.security : document.security);
			if (operation.servers || pathItem.servers) warnings.push({ code: 'operation-server', subject: `${method.toUpperCase()} ${template}` });
		}
	}
	return { routes, requirements };
}
function importRelayOperations(document: JsonRecord, documentUrl?: string): RelayOpenApiImport {
	const warnings: RelayOpenApiWarning[] = [];
	const { routes, requirements } = collectOperations(document, warnings);
	const unique = new Map<string, ImportedRelayRoute>();
	for (const route of routes) {
		const identity = routeIdentity(route);
		if (unique.has(identity)) warnings.push({ code: 'duplicate', subject: `${route.method} ${route.path}` });
		else unique.set(identity, route);
	}
	const metadata = recordOrEmpty(document.info);
	return {
		title: stringOrEmpty(metadata.title), version: stringOrEmpty(metadata.version),
		routes: [...unique.values()].sort(compareImportedRoutes), warnings,
		auth: authSuggestion(document, requirements, warnings),
		baseUrl: suggestedBaseUrl(document, documentUrl, warnings),
	};
}

function existingRoutes(source: string): ImportedRelayRoute[] {
	let parsed: unknown;
	try { parsed = JSON.parse(source.trim() || '[]'); }
	catch { throw new Error('openapi-existing-routes'); }
	if (!Array.isArray(parsed) || parsed.some(route => !isJsonRecord(route) || typeof route.method !== 'string' || !routeMethods.includes(route.method.toUpperCase()) || typeof route.path !== 'string'
		|| (route.headers !== undefined && (!isJsonRecord(route.headers) || Object.values(route.headers).some(matcher => typeof matcher !== 'string'))))) throw new Error('openapi-existing-routes');
	return parsed;
}

export function reviewRelayImport(currentRoutes: string, imported: RelayOpenApiImport): RelayImportReview {
	if (!imported.routes.length) throw new Error('openapi-no-routes');
	const existing = existingRoutes(currentRoutes);
	const existingByIdentity = new Map(existing.map(route => [routeIdentity(route), route]));
	if (existingByIdentity.size !== existing.length) throw new Error('openapi-existing-routes');
	const identities = new Set(imported.routes.map(routeIdentity));
	return {
		routes: imported.routes.map(route => ({ ...existingByIdentity.get(routeIdentity(route)), ...route })),
		removed: existing.filter(route => !identities.has(routeIdentity(route))),
		preserved: imported.routes.filter(route => existingByIdentity.has(routeIdentity(route))).length,
	};
}

export function applyRelayImport(draft: RelayDraft, change: { imported: RelayOpenApiImport; review: RelayImportReview; useBaseUrl: boolean; useAuth: boolean }): RelayDraft {
	const auth = change.useAuth ? change.imported.auth : undefined;
	return {
		...draft,
		routesJson: JSON.stringify(change.review.routes, null, 2),
		baseUrl: change.useBaseUrl && change.imported.baseUrl ? change.imported.baseUrl : draft.baseUrl,
		...(auth ? { authType: auth.type, headerName: auth.headerName ?? '', queryParam: auth.queryParam ?? '', valuePrefix: '' } : {}),
	};
}

export function relaySpecUrl(source: string): string {
	const trimmed = source.trim();
	const parsed = resolveServerUrl(trimmed, undefined, true);
	if (!parsed) throw new Error('openapi-url');
	return trimmed;
}

export function relayOpenApiError(cause: unknown, locale: string): string {
	const messages: Record<string, [string, string]> = {
		'openapi-empty': ['文档为空。', 'The document is empty.'],
		'openapi-too-large': ['文档超过 5 MiB 限制。', 'The document exceeds 5 MiB.'],
		'openapi-invalid-document': ['JSON/YAML 无效，或包含重复键、不安全别名或不支持的标签。', 'Invalid JSON/YAML, duplicate keys, unsafe aliases or unsupported tags.'],
		'openapi-object': ['文档根节点必须是对象。', 'The document root must be an object.'],
		'openapi-version': ['仅支持 OpenAPI 3.0/3.1/3.2 或 Swagger 2.0 文档。', 'Expected OpenAPI 3.0/3.1/3.2 or Swagger 2.0.'],
		'openapi-no-routes': ['没有可导入的操作，现有路由保持不变。', 'No operations to import; existing routes are unchanged.'],
		'openapi-existing-routes': ['当前路由 JSON 无效或身份重复，请先修正。', 'Fix invalid or duplicate existing routes before importing.'],
		'openapi-url': ['文档地址必须是无用户信息和片段的绝对 HTTP(S) URL。', 'Use an absolute HTTP(S) URL without user info or fragment.'],
		'openapi-response': ['文档获取响应格式错误。', 'Invalid document fetch response.'],
	};
	const code = cause instanceof Error ? cause.message : '';
	return messages[code]?.[locale === 'zh-CN' ? 0 : 1] ?? (locale === 'zh-CN' ? '无法读取 OpenAPI 文档。' : 'Unable to read the OpenAPI document.');
}

export function relayOpenApiWarning(warning: RelayOpenApiWarning, locale: string): string {
	const labels: Record<RelayOpenApiWarning['code'], [string, string]> = {
		reference: ['引用无法解析，相关操作未导入', 'Unresolved reference; operations not imported'],
		operation: ['无法表示为 Relay 路由的操作未导入', 'Operation cannot be represented as a relay route; not imported'],
		auth: ['认证要求不明确或不受支持；未建议自动切换认证', 'Ambiguous or unsupported security requirements; no auth suggestion'],
		server: ['未找到可用的上游地址，保留当前地址', 'No usable server URL; keep the current base URL'],
		'server-query': ['上游地址中的查询参数未导入', 'Server query parameters are not imported'],
		'operation-server': ['操作/路径自定义服务器未导入，沿用端点地址', 'Operation/path-specific server is not imported; endpoint base URL applies'],
		duplicate: ['等价路由已去重，请检查通配范围', 'Equivalent routes deduplicated; review wildcard coverage'],
	};
	return `${labels[warning.code][locale === 'zh-CN' ? 0 : 1]}${warning.subject ? `: ${warning.subject}` : ''}`;
}
