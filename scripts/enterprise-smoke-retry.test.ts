import { describe, expect, test } from 'bun:test';
import {
    runGatewayWithRetries,
} from './enterprise-smoke-gateway-retry';
import {
    startPostgresWithDependencies,
    type StartPostgresDependencies,
} from './enterprise-smoke-postgres';

function createPostgresDependencies(
    overrides: Partial<StartPostgresDependencies> = {},
): StartPostgresDependencies {
    return {
        env: {},
        requireBinary: (name) => `/mock/bin/${name}`,
        allocatePort: async () => 61000,
        makeTempDir: async () => '/tmp/elygate-enterprise-pg.test',
        writePostgresConfig: async () => undefined,
        runCommand: async () => '',
        removeDir: async () => undefined,
        warn: () => undefined,
        ...overrides,
    };
}

describe('enterprise smoke PostgreSQL retry contract', () => {
    test('retries automatic port startup with fresh port and cleanup', async () => {
        const ports = [62100, 62101];
        const tempDirs = ['/tmp/elygate-pg-failed', '/tmp/elygate-pg-ok'];
        const removedDirs: string[] = [];
        const configuredPorts: number[] = [];
        const warnings: string[] = [];
        let allocated = 0;
        let createdDirs = 0;
        let pgCtlStarts = 0;

        const result = await startPostgresWithDependencies(createPostgresDependencies({
            allocatePort: async () => ports[allocated++] ?? 62999,
            makeTempDir: async () => tempDirs[createdDirs++] ?? '/tmp/elygate-pg-extra',
            writePostgresConfig: async (_dataDir, port) => {
                configuredPorts.push(port);
            },
            runCommand: async (command, args) => {
                if (command.endsWith('/pg_ctl') && args.includes('start')) {
                    pgCtlStarts += 1;
                    if (pgCtlStarts === 1) throw new Error('EADDRINUSE: port already in use');
                }
                return '';
            },
            removeDir: async (dir) => {
                removedDirs.push(dir);
            },
            warn: (message) => {
                warnings.push(message);
            },
        }));

        expect(result.port).toBe(62101);
        expect(result.dir).toBe('/tmp/elygate-pg-ok');
        expect(result.databaseUrl).toContain(':62101/postgres');
        expect(allocated).toBe(2);
        expect(configuredPorts).toEqual([62100, 62101]);
        expect(removedDirs).toEqual(['/tmp/elygate-pg-failed']);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('start retry 1/5');
    });

    test('fails fast on explicit database port and still cleans temporary data', async () => {
        const removedDirs: string[] = [];
        let allocated = 0;
        let pgCtlStarts = 0;

        await expect(startPostgresWithDependencies(createPostgresDependencies({
            env: { ENTERPRISE_SMOKE_DB_PORT: '62222' },
            allocatePort: async () => {
                allocated += 1;
                return 62100;
            },
            makeTempDir: async () => '/tmp/elygate-pg-explicit',
            runCommand: async (command, args) => {
                if (command.endsWith('/pg_ctl') && args.includes('start')) {
                    pgCtlStarts += 1;
                    throw new Error('EADDRINUSE: explicit port in use');
                }
                return '';
            },
            removeDir: async (dir) => {
                removedDirs.push(dir);
            },
        }))).rejects.toThrow('explicit port in use');

        expect(allocated).toBe(0);
        expect(pgCtlStarts).toBe(1);
        expect(removedDirs).toEqual(['/tmp/elygate-pg-explicit']);
    });
});

describe('enterprise smoke gateway retry contract', () => {
    test('retries automatic gateway port only for address-in-use errors', async () => {
        const attemptedPorts: number[] = [];
        const cleanedPorts: number[] = [];
        const warnings: string[] = [];

        const result = await runGatewayWithRetries({
            explicitPort: null,
            initialPort: 63100,
            allocatePort: async () => 63101,
            runAttempt: async (port) => {
                attemptedPorts.push(port);
                if (attemptedPorts.length === 1) throw new Error('EADDRINUSE: port already in use');
            },
            cleanupAttempt: (_error, _attempt, port) => {
                cleanedPorts.push(port);
            },
            warn: (message) => {
                warnings.push(message);
            },
        });

        expect(result).toBe(63101);
        expect(attemptedPorts).toEqual([63100, 63101]);
        expect(cleanedPorts).toEqual([63100]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('gateway port retry 1/5');
    });

    test('fails fast on explicit gateway port even when the error is retryable', async () => {
        let allocated = 0;
        const attemptedPorts: number[] = [];
        const cleanedPorts: number[] = [];

        await expect(runGatewayWithRetries({
            explicitPort: 63200,
            initialPort: 63200,
            allocatePort: async () => {
                allocated += 1;
                return 63201;
            },
            runAttempt: async (port) => {
                attemptedPorts.push(port);
                throw new Error('EADDRINUSE: explicit gateway port in use');
            },
            cleanupAttempt: (_error, _attempt, port) => {
                cleanedPorts.push(port);
            },
        })).rejects.toThrow('explicit gateway port in use');

        expect(allocated).toBe(0);
        expect(attemptedPorts).toEqual([63200]);
        expect(cleanedPorts).toEqual([63200]);
    });

    test('does not retry automatic gateway port for non-address-in-use errors', async () => {
        let allocated = 0;
        const attemptedPorts: number[] = [];
        const cleanedPorts: number[] = [];

        await expect(runGatewayWithRetries({
            explicitPort: null,
            initialPort: 63300,
            allocatePort: async () => {
                allocated += 1;
                return 63301;
            },
            runAttempt: async (port) => {
                attemptedPorts.push(port);
                throw new Error('gateway exited before readiness');
            },
            cleanupAttempt: (_error, _attempt, port) => {
                cleanedPorts.push(port);
            },
        })).rejects.toThrow('gateway exited before readiness');

        expect(allocated).toBe(0);
        expect(attemptedPorts).toEqual([63300]);
        expect(cleanedPorts).toEqual([63300]);
    });
});
