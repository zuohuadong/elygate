import { describe, expect, test } from 'bun:test';
import { emptyRelayDraft } from './relay-management';
import {
	applyRelayImport,
	checkRelaySpecSize,
	parseRelayOpenApi,
	relaySpecUrl,
	reviewRelayImport,
} from './relay-openapi';

describe('relay OpenAPI import', () => {
	test('parses OpenAPI YAML, maps routes, auth, and server suggestions', async () => {
		const imported = await parseRelayOpenApi(`
openapi: 3.0.3
info:
  title: Example API
  version: 1.2.0
servers:
  - url: https://api.example.test/v1
components:
  securitySchemes:
    apiKey:
      type: apiKey
      in: header
      name: X-Api-Key
security:
  - apiKey: []
paths:
  /health:
    get:
      responses:
        '200':
          description: ok
  /users/{userId}:
    post:
      responses:
        '200':
          description: ok
    options:
      responses:
        '204':
          description: no content
`);

		expect(imported.title).toBe('Example API');
		expect(imported.version).toBe('1.2.0');
		expect(imported.baseUrl).toBe('https://api.example.test/v1');
		expect(imported.auth).toEqual({ type: 'header', headerName: 'X-Api-Key' });
		expect(imported.routes).toEqual([
			{ method: 'GET', path: '/health' },
			{ method: 'POST', path: '/users/*' },
		]);
		expect(imported.warnings).toContainEqual({ code: 'operation', subject: 'OPTIONS /users/{userId}' });
	});

	test('parses Swagger 2 and AWS target header routes', async () => {
		const imported = await parseRelayOpenApi(`
swagger: '2.0'
info:
  title: AWS facade
  version: 1.0.0
schemes: [https]
host: execute-api.example.test
basePath: /prod
securityDefinitions:
  bearer:
    type: basic
security: [{bearer: []}]
paths:
  /#X-Amz-Target=Textract.AnalyzeDocument:
    post:
      responses:
        '200':
          description: ok
`);

		expect(imported.baseUrl).toBe('https://execute-api.example.test/prod');
		expect(imported.auth).toEqual({ type: 'basic' });
		expect(imported.routes).toEqual([
			{ method: 'POST', path: '/', headers: { 'X-Amz-Target': 'Textract.AnalyzeDocument' } },
		]);
	});

	test('follows internal refs and warns instead of fetching external refs', async () => {
		const imported = await parseRelayOpenApi(`
openapi: 3.1.0
info: {title: refs, version: 1}
components:
  pathItems:
    Local:
      get:
        responses: {'200': {description: ok}}
paths:
  /local:
    $ref: '#/components/pathItems/Local'
  /remote:
    $ref: 'https://example.test/openapi.yaml#/paths/~1remote'
`);

		expect(imported.routes).toEqual([{ method: 'GET', path: '/local' }]);
		expect(imported.warnings).toContainEqual({ code: 'reference', subject: '/remote' });
	});

	test('rejects duplicate keys, unsupported versions, and oversized documents', async () => {
		await expect(parseRelayOpenApi('openapi: 3.0.0\nopenapi: 3.1.0')).rejects.toThrow('openapi-invalid-document');
		await expect(parseRelayOpenApi('openapi: 2.0.0\ninfo: {}\npaths: {}')).rejects.toThrow('openapi-version');
		expect(() => checkRelaySpecSize('x'.repeat(5 * 1024 * 1024 + 1))).toThrow('openapi-too-large');
	});

	test('sorts routes and preserves existing settings in the review', async () => {
		const imported = await parseRelayOpenApi(`
openapi: 3.2.0
info: {title: routes, version: 1}
paths:
  /users/{id}:
    get: {responses: {'200': {description: ok}}}
  /health:
    get: {responses: {'200': {description: ok}}}
`);
		const review = reviewRelayImport(JSON.stringify([
			{ method: 'GET', path: '/health', pricing: { cost_per_request: 0.25 }, enabled: false },
			{ method: 'DELETE', path: '/legacy' },
		]), imported);

		expect(review.routes).toEqual([
			{ method: 'GET', path: '/health', pricing: { cost_per_request: 0.25 }, enabled: false },
			{ method: 'GET', path: '/users/*' },
		]);
		expect(review.preserved).toBe(1);
		expect(review.removed).toEqual([{ method: 'DELETE', path: '/legacy' }]);
	});

	test('applies only after explicit choices and keeps the rest of the draft', async () => {
		const imported = await parseRelayOpenApi(`
openapi: 3.0.0
info: {title: apply, version: 1}
servers: [{url: https://upstream.example.test/api}]
components:
  securitySchemes:
    token:
      type: http
      scheme: bearer
paths:
  /chat:
    post: {responses: {'200': {description: ok}}}
security: [{token: []}]
`);
		const review = reviewRelayImport('[]', imported);
		const draft = { ...emptyRelayDraft(), authType: 'none' as const, description: 'keep me', baseUrl: 'https://current.example.test' };
		const unchanged = applyRelayImport(draft, { imported, review, useBaseUrl: false, useAuth: false });
		expect(unchanged.description).toBe('keep me');
		expect(unchanged.baseUrl).toBe('https://current.example.test');
		expect(unchanged.authType).toBe('none');

		const applied = applyRelayImport(draft, { imported, review, useBaseUrl: true, useAuth: true });
		expect(applied.baseUrl).toBe('https://upstream.example.test/api');
		expect(applied.authType).toBe('bearer');
		expect(JSON.parse(applied.routesJson)).toEqual([{ method: 'POST', path: '/chat' }]);
	});

	test('accepts only absolute HTTP(S) document URLs', () => {
		expect(relaySpecUrl('https://example.test/openapi.yaml')).toBe('https://example.test/openapi.yaml');
		for (const candidate of ['', '/openapi.yaml', 'ftp://example.test/spec', 'https://user:pass@example.test/spec', 'https://example.test/spec#fragment']) {
			expect(() => relaySpecUrl(candidate)).toThrow('openapi-url');
		}
	});

	test('keeps distinct path and header whitespace identities for billing review', async () => {
		const imported = await parseRelayOpenApi(JSON.stringify({
			openapi: '3.1.0', paths: {
				'/foo': { get: {} },
				'/#X-Amz-Target=Action': { post: {} },
			},
		}));
		const review = reviewRelayImport(JSON.stringify([
			{ method: 'GET', path: '/foo ', billable: false },
			{ method: 'POST', path: '/', headers: { 'x-amz-target': 'Action ' }, billable: false },
		]), imported);
		expect(review.preserved).toBe(0);
		expect(review.removed).toHaveLength(2);
		expect(review.routes.every(route => !Object.hasOwn(route, 'billable'))).toBe(true);
		const caseOnly = reviewRelayImport(JSON.stringify([
			{ method: 'post', path: '/', headers: { 'x-amz-target': 'Action' }, billable: false },
		]), imported);
		expect(caseOnly.preserved).toBe(1);
		expect(caseOnly.routes.find(route => route.method === 'POST')?.billable).toBe(false);
	});

	test('does not suggest an auth when alternatives or operation requirements disagree', async () => {
		const document = {
			openapi: '3.1.0', components: { securitySchemes: {
				a: { type: 'http', scheme: 'bearer' },
				b: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
			} },
			security: [{ a: [] }, { b: [] }],
			paths: { '/private': { get: {} } },
		};
		const alternatives = await parseRelayOpenApi(JSON.stringify(document));
		expect(alternatives.auth).toBeUndefined();
		expect(alternatives.warnings).toContainEqual({ code: 'auth', subject: '' });
		const mixed = await parseRelayOpenApi(JSON.stringify({
			...document, security: [{ a: [] }],
			paths: { ...document.paths, '/public': { get: { security: [] } } },
		}));
		expect(mixed.auth).toBeUndefined();
		expect(mixed.warnings).toContainEqual({ code: 'auth', subject: '' });
		const publicOnly = await parseRelayOpenApi(JSON.stringify({ ...document, security: undefined }));
		expect(publicOnly.auth).toBeUndefined();
	});

	test('orders specific paths and header-qualified operations before broader routes', async () => {
		const imported = await parseRelayOpenApi(JSON.stringify({
			openapi: '3.2.0', paths: {
				'/models/{model}': { post: {} },
				'/models/{model}:predict': { post: {} },
				'/': { post: {} },
				'/#X-Amz-Target=Action': { post: {} },
				'/files/{name}{extension}': { get: {} },
				'/files/literal%2A': { get: {} },
			},
		}));
		const identities = imported.routes.map(route => `${route.path}:${Object.keys(route.headers ?? {}).length}`);
		expect(identities.indexOf('/:1')).toBeLessThan(identities.indexOf('/:0'));
		expect(identities.indexOf('/models/*:predict:0')).toBeLessThan(identities.indexOf('/models/*:0'));
		expect(identities.indexOf('/files/literal\\*:0')).toBeLessThan(identities.indexOf('/files/*:0'));
		expect(imported.routes.some(route => route.path === '/files/**')).toBe(false);
	});

	test('selects usable server candidates and resolves empty servers against the fetched URL', async () => {
		const imported = await parseRelayOpenApi(JSON.stringify({
			openapi: '3.1.0', servers: [{ url: 'https://{missing}.example.test' }, { url: './api?version=2' }],
		}), 'https://docs.example.test/v2/openapi.yaml');
		expect(imported.baseUrl).toBe('https://docs.example.test/v2/api');
		expect(imported.warnings).toContainEqual({ code: 'server-query', subject: '' });
		const defaults = await parseRelayOpenApi('{"openapi":"3.1.0","servers":[]}', 'http://docs.example.test/spec');
		expect(defaults.baseUrl).toBe('http://docs.example.test');
	});
});
