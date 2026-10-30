import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { trackedChild, stopChild, waitFor, type RuntimeChild } from './process';

const execFileAsync = promisify(execFile);
const databaseNames = ['relay_config', 'relay_logs'] as const;
const restoredNames = ['relay_config_restored', 'relay_logs_restored'] as const;
const pgUser = 'relay_acceptance';

function identifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function literal(content: string): string {
	return `'${content.replaceAll("'", "''")}'`;
}

export class PrivatePostgres {
	private readonly directory: string;
	private readonly socket: string;
	private readonly env: NodeJS.ProcessEnv;
	private postgres?: RuntimeChild;
	private databases: readonly string[] = databaseNames;
	private sourceFingerprints?: string[];
	private initialized = false;

	constructor(private readonly bin: string, workspace: string) {
		assert.ok(path.isAbsolute(bin), 'ELYGATE_TEST_POSTGRES_BIN must be an absolute PostgreSQL bin directory');
		this.directory = path.join(workspace, 'pg');
		this.socket = path.join(this.directory, 's');
		assert.ok(this.socket.length <= 90, 'private PostgreSQL Unix socket path exceeds 90 characters');
		this.env = { PATH: process.env.PATH, HOME: workspace, TMPDIR: workspace, LC_ALL: 'C' };
	}

	private async run(tool: string, args: string[]): Promise<string> {
		const { stdout } = await execFileAsync(path.join(this.bin, tool), args, {
			env: this.env, timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
		});
		return stdout.trim();
	}

	private connection(database: string): string[] {
		assert.ok(['postgres', ...databaseNames, ...restoredNames].includes(database), 'unknown private database');
		return ['-h', this.socket, '-p', '5432', '-U', pgUser, '-w', '-d', database];
	}

	private async query(database: string, sql: string): Promise<string> {
		return this.run('psql', [...this.connection(database), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]);
	}

	async initialize(): Promise<void> {
		await mkdir(this.socket, { recursive: true, mode: 0o700 });
		await this.run('initdb', ['-D', path.join(this.directory, 'data'), `--username=${pgUser}`,
			'--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--no-locale']);
		await this.start();
		for (const name of databaseNames) await this.query('postgres', `CREATE DATABASE ${identifier(name)}`);
		const settings = await this.query('postgres', `SELECT json_build_array(current_setting('fsync'),
			current_setting('synchronous_commit'), current_setting('full_page_writes'), current_setting('listen_addresses'))`);
		assert.deepEqual(JSON.parse(settings), ['on', 'on', 'on', '']);
		this.initialized = true;
		console.log('PASS private PostgreSQL: socket-only, durability enabled, two fresh databases');
	}

	private async start(): Promise<void> {
		const runtime = trackedChild(path.join(this.bin, 'postgres'), [
			'-D', path.join(this.directory, 'data'), '-h', '', '-k', this.socket, '-p', '5432',
			'-c', 'unix_socket_permissions=0700',
		], { cwd: this.directory, env: this.env });
		this.postgres = runtime;
		await waitFor(async () => {
			assert.ifError(runtime.failure());
			assert.equal(runtime.child.exitCode, null, runtime.output());
			try {
				await this.run('pg_isready', ['-h', this.socket, '-p', '5432', '-U', pgUser, '-d', 'postgres']);
				return true;
			} catch (cause) {
				if ([1, 2].includes(Number((cause as NodeJS.ErrnoException).code))) return false;
				throw cause;
			}
		}, 'private PostgreSQL startup');
	}

	async stop(): Promise<void> {
		if (!this.postgres) return;
		const runtime = this.postgres;
		try {
			assert.equal(runtime.child.exitCode, null, runtime.output());
			await this.run('pg_ctl', ['-D', path.join(this.directory, 'data'), '-m', 'fast', '-w', '-t', '30', 'stop']);
		} finally {
			// 即使 pg_ctl 失败，也必须回收本次创建的 postgres 子进程。
			await stopChild(runtime);
			this.postgres = undefined;
		}
	}

	async restart(): Promise<void> {
		await this.stop();
		await this.start();
	}

	stores(): Record<string, unknown> {
		const config = (database: string) => ({
			host: this.socket, port: '5432', user: pgUser, password: 'env.ELYGATE_RELAY_TEST_PG_PASSWORD',
			db_name: database, ssl_mode: 'disable', max_idle_conns: 2, max_open_conns: 4,
		});
		return {
			config_store: { enabled: true, type: 'postgres', config: config(this.databases[0]) },
			logs_store: { enabled: true, type: 'postgres', config: {
				...config(this.databases[1]), matview_refresh_interval: 'off',
			} },
		};
	}

	async verifyLiveStores(appDir: string): Promise<void> {
		const rows = await this.query('postgres', `SELECT count(DISTINCT datname) FROM pg_stat_activity
			WHERE datname IN (${this.databases.map(literal).join(',')})`);
		assert.equal(rows, '2', 'both configured PostgreSQL databases must have live connections');
		for (const filename of ['config.db', 'logs.db']) {
			await assert.rejects(stat(path.join(appDir, filename)), { code: 'ENOENT' });
		}
	}

	private async fingerprints(database: string): Promise<string> {
		const tableNames: string[] = JSON.parse(await this.query(database, `SELECT COALESCE(json_agg(tablename
			ORDER BY tablename), '[]') FROM pg_tables WHERE schemaname = 'public'`));
		assert.ok(tableNames.length > 0, 'database must contain migrated tables');
		const queries = tableNames.map(name => `SELECT ${literal(name)} AS name, count(*) AS rows,
			md5(COALESCE(string_agg(to_jsonb(snapshot)::text, E'\\n' ORDER BY to_jsonb(snapshot)::text), '')) AS checksum
			FROM public.${identifier(name)} AS snapshot`);
		const tables = await this.query(database, `SELECT json_agg(summary ORDER BY name) FROM (${queries.join(' UNION ALL ')}) AS summary`);
		const sequences = await this.query(database, `SELECT COALESCE(json_agg(snapshot ORDER BY sequencename), '[]')
			FROM (SELECT * FROM pg_sequences WHERE schemaname = 'public') AS snapshot`);
		return JSON.stringify({ tables: JSON.parse(tables), sequences: JSON.parse(sequences) });
	}

	async restoreBackup(appDir: string): Promise<void> {
		assert.deepEqual(this.databases, databaseNames, 'restore runs once into distinct fresh databases');
		assert.equal(await this.query('postgres', `SELECT count(*) FROM pg_stat_activity WHERE datname IN
			(${databaseNames.map(literal).join(',')})`), '0', 'gateway pools must be closed before backup');
		const backup = path.join(this.directory, 'backup');
		await mkdir(backup, { mode: 0o700 });
		await cp(appDir, path.join(backup, 'app'), { recursive: true, errorOnExist: true, force: false });
		const before = await Promise.all(databaseNames.map(name => this.fingerprints(name)));
		this.sourceFingerprints = before;
		for (const [index, name] of databaseNames.entries()) {
			const archive = path.join(backup, `${name}.dump`);
			await this.run('pg_dump', [...this.connection(name), '--format=custom', '--file', archive]);
			await this.query('postgres', `CREATE DATABASE ${identifier(restoredNames[index])}`);
			await this.run('pg_restore', [...this.connection(restoredNames[index]), '--exit-on-error',
				'--single-transaction', '--no-owner', '--no-privileges', archive]);
		}
		assert.deepEqual(await Promise.all(restoredNames.map(name => this.fingerprints(name))), before,
			'all table rows and sequence state must survive both database restores');
		assert.deepEqual(await Promise.all(databaseNames.map(name => this.fingerprints(name))), before,
			'restoring into fresh databases must leave both source databases unchanged');
		await rename(appDir, path.join(backup, 'source-app'));
		await cp(path.join(backup, 'app'), appDir, { recursive: true, errorOnExist: true, force: false });
		this.databases = restoredNames;
		const config = JSON.parse(await readFile(path.join(appDir, 'config.json'), 'utf8'));
		await writeFile(path.join(appDir, 'config.json'), JSON.stringify({ ...config, ...this.stores() }), { mode: 0o600 });
		console.log('PASS quiesced dual-store pg_dump/pg_restore: all tables, sequences and source isolation');
	}

	async verifyCleanup(): Promise<void> {
		if (!this.initialized) return;
		if (this.sourceFingerprints) {
			assert.deepEqual(await Promise.all(databaseNames.map(name => this.fingerprints(name))), this.sourceFingerprints,
				'restored gateway reads and writes must not modify either source database');
		}
		for (const name of [...databaseNames, ...restoredNames]) {
			await this.query('postgres', `DROP DATABASE IF EXISTS ${identifier(name)}`);
		}
		assert.equal(await this.query('postgres', `SELECT count(*) FROM pg_database WHERE datname IN
			(${[...databaseNames, ...restoredNames].map(literal).join(',')})`), '0');
		console.log('PASS private PostgreSQL database cleanup');
	}
}
