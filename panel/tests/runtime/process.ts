import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function availablePort(): Promise<number> {
	const listener = createServer();
	listener.listen(0, '127.0.0.1');
	await once(listener, 'listening');
	const port = (listener.address() as AddressInfo).port;
	await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
	return port;
}

export function trackedChild(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
	const child = spawn(command, args, { ...options, stdio: 'pipe' });
	let output = '';
	let failure: Error | undefined;
	child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-16_384); });
	child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(-16_384); });
	const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		child.once('error', error => { failure = error; resolve({ code: null, signal: null }); });
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	child.stdin.end();
	return { child, exit, output: () => output, failure: () => failure };
}

export type RuntimeChild = ReturnType<typeof trackedChild>;

export async function stopChild(runtime: RuntimeChild): Promise<void> {
	if (runtime.child.exitCode === null && runtime.child.signalCode === null) runtime.child.kill('SIGTERM');
	const status = await Promise.race([runtime.exit, delay(40_000, null, { ref: false })]);
	if (status === null) {
		runtime.child.kill('SIGKILL');
		await runtime.exit;
		throw new Error('isolated runtime did not stop gracefully within 40 seconds');
	}
	assert.ifError(runtime.failure());
	assert.deepEqual(status, { code: 0, signal: null }, 'isolated runtime exited unsuccessfully');
}

export async function waitFor(probe: () => Promise<boolean>, description: string): Promise<void> {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (await probe()) return;
		await delay(250);
	}
	throw new Error(`timed out waiting for ${description}`);
}

export async function waitForHTTP(url: string, runtime: RuntimeChild): Promise<void> {
	await waitFor(async () => {
		assert.ifError(runtime.failure());
		assert.equal(runtime.child.exitCode, null, 'runtime exited during startup');
		assert.equal(runtime.child.signalCode, null, 'runtime was killed during startup');
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			await response.arrayBuffer();
			return response.status === 200;
		} catch (cause) {
			const code = (cause as { cause?: { code?: string }; code?: string }).cause?.code
				?? (cause as { code?: string }).code;
			if (code === 'ECONNREFUSED' || code === 'ConnectionRefused') return false;
			throw cause;
		}
	}, url);
}
