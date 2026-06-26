import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ENTERPRISE_SMOKE_POSTGRES_BIN_DIR = process.env.POSTGRES_BIN_DIR || '/opt/homebrew/opt/postgresql@18/bin';
export const ENTERPRISE_SMOKE_DB_USER = process.env.ENTERPRISE_SMOKE_DB_USER || 'postgres';

export type TempPostgres = {
    readonly dir: string;
    readonly port: number;
    readonly databaseUrl: string;
};

export type StartPostgresDependencies = {
    readonly env: Record<string, string | undefined>;
    readonly requireBinary: (name: string) => string;
    readonly allocatePort: () => Promise<number>;
    readonly makeTempDir: () => Promise<string>;
    readonly writePostgresConfig: (dataDir: string, port: number) => Promise<void>;
    readonly runCommand: typeof run;
    readonly removeDir: (dir: string) => Promise<void>;
    readonly warn: (message: string) => void;
};

function requiredBinary(name: string): string {
    const path = join(ENTERPRISE_SMOKE_POSTGRES_BIN_DIR, name);
    if (!existsSync(path)) {
        throw new Error(`Missing ${name}. Set POSTGRES_BIN_DIR or install postgresql@18. Expected ${path}`);
    }
    return path;
}

export function parsePort(value: string | undefined, label: string): number | null {
    if (!value) return null;
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`${label} must be a valid TCP port, got ${value}`);
    }
    return port;
}

export async function findFreePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to resolve allocated TCP port')));
                return;
            }
            const port = address.port;
            server.close((error) => {
                if (error) reject(error);
                else resolve(port);
            });
        });
    });
}

export function databaseUrlForPort(port: number): string {
    return `postgresql://${ENTERPRISE_SMOKE_DB_USER}@127.0.0.1:${port}/postgres`;
}

async function writePostgresConfig(dataDir: string, port: number): Promise<void> {
    await writeFile(join(dataDir, 'postgresql.conf'), [
        `listen_addresses = '127.0.0.1'`,
        `port = ${port}`,
        `shared_preload_libraries = 'pg_cron'`,
        `cron.database_name = 'postgres'`,
        '',
    ].join('\n'), { flag: 'a' });
}

export async function run(command: string, args: readonly string[], options: { env?: Record<string, string>; cwd?: string } = {}): Promise<string> {
    const proc = Bun.spawn([command, ...args], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0) {
        throw new Error([
            `Command failed (${exitCode}): ${command} ${args.join(' ')}`,
            stdout.trim(),
            stderr.trim(),
        ].filter(Boolean).join('\n'));
    }
    return stdout;
}

export async function startPostgres(): Promise<TempPostgres> {
    return startPostgresWithDependencies({
        env: process.env,
        requireBinary: requiredBinary,
        allocatePort: findFreePort,
        makeTempDir: () => mkdtemp(join(tmpdir(), 'elygate-enterprise-pg.')),
        writePostgresConfig,
        runCommand: run,
        removeDir: (dir) => rm(dir, { recursive: true, force: true }),
        warn: console.warn,
    });
}

export async function startPostgresWithDependencies(dependencies: StartPostgresDependencies): Promise<TempPostgres> {
    const initdb = dependencies.requireBinary('initdb');
    const pgCtl = dependencies.requireBinary('pg_ctl');
    const explicitPort = parsePort(dependencies.env.ENTERPRISE_SMOKE_DB_PORT, 'ENTERPRISE_SMOKE_DB_PORT');
    const maxAttempts = explicitPort ? 1 : 5;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const port = explicitPort ?? await dependencies.allocatePort();
        const dir = await dependencies.makeTempDir();
        const dataDir = join(dir, 'data');
        try {
            await dependencies.runCommand(initdb, ['-D', dataDir, '-A', 'trust', '-U', ENTERPRISE_SMOKE_DB_USER, '--locale=C', '-E', 'UTF8']);
            await dependencies.writePostgresConfig(dataDir, port);
            await dependencies.runCommand(pgCtl, ['-D', dataDir, '-l', join(dir, 'postgres.log'), '-w', 'start']);
            return {
                dir,
                port,
                databaseUrl: databaseUrlForPort(port),
            };
        } catch (error) {
            lastError = error;
            await dependencies.removeDir(dir);
            if (explicitPort || attempt === maxAttempts) break;
            dependencies.warn(`[enterprise-smoke-postgres] start retry ${attempt}/${maxAttempts}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function stopPostgres(dir: string): Promise<void> {
    const pgCtl = requiredBinary('pg_ctl');
    await run(pgCtl, ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']).catch((error: unknown) => {
        console.warn(`[enterprise-smoke-postgres] postgres stop warning: ${error instanceof Error ? error.message : String(error)}`);
    });
    await rm(dir, { recursive: true, force: true });
}
