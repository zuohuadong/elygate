import { expect, test } from 'bun:test';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createViteServer } from 'vite';

test('API proxy preserves browser Host and Origin for guarded administrator writes', async () => {
	const backend = createHttpServer((request, response) => {
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify({ host: request.headers.host, origin: request.headers.origin }));
	});
	await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
	let proxy: Awaited<ReturnType<typeof createViteServer>> | undefined;
	try {
		const backendPort = (backend.address() as AddressInfo).port;
		proxy = await createViteServer({
			root: new URL('../../', import.meta.url).pathname,
			configFile: new URL('../../vite.config.ts', import.meta.url).pathname,
			optimizeDeps: { noDiscovery: true, include: [] },
			server: {
				host: '127.0.0.1', port: 0, strictPort: true,
				proxy: { '/api': { target: `http://127.0.0.1:${backendPort}` } },
			},
		});
		await proxy.listen();
		const proxyHost = `127.0.0.1:${(proxy.httpServer!.address() as AddressInfo).port}`;
		// Same-origin writes must match Host; foreign Origin must remain foreign.
		for (const origin of [`http://${proxyHost}`, 'http://untrusted.invalid']) {
			for (const method of ['POST', 'PUT', 'DELETE']) {
				const response = await fetch(`http://${proxyHost}/api/control-plane/projects`, {
					method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
				});
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ host: proxyHost, origin });
			}
		}
	} finally {
		await proxy?.close();
		await new Promise<void>((resolve, reject) => backend.close(error => error ? reject(error) : resolve()));
	}
}, 30_000);
