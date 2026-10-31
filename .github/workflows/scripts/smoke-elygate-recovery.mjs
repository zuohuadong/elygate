import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

class RecoveryFailure extends Error {}
const check = (condition, label) => { if (!condition) throw new RecoveryFailure(label); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateCandidate(args) {
	check(args.length === 2 && /^sha256:[a-f0-9]{64}$/.test(args[0]) &&
		/^[a-f0-9]{40}$/.test(args[1]), 'expected immutable image ID and full Git commit SHA');
}

// Docker config IDs and OCI manifest digests identify different objects.
export function candidateManifest(index, readBlob, imageID) {
	const candidates = [];
	for (const descriptor of index.manifests ?? []) {
		check(/^sha256:[a-f0-9]{64}$/.test(descriptor.digest), 'invalid OCI descriptor');
		const bytes = readBlob(descriptor.digest.slice(7));
		check(`sha256:${sha256(bytes)}` === descriptor.digest, 'OCI manifest checksum mismatch');
		const manifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
		if (manifest.manifests) {
			const nested = candidateManifest(manifest, readBlob, imageID);
			if (nested) candidates.push(nested);
		} else if (manifest.config?.digest === imageID) {
			candidates.push(descriptor);
		}
	}
	check(candidates.length <= 1, 'ambiguous OCI candidate manifests');
	return candidates[0];
}

export function command(binary, args, options = {}) {
	const child = spawnSync(binary, args, {
		encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
		stdio: ['pipe', 'pipe', 'pipe'], ...options,
	});
	// A timed-out PTY/daemon call can report status=0 alongside ETIMEDOUT.
	check(!child.error && !child.signal && child.status === 0, `${binary} command failed (output suppressed)`);
	return child.stdout?.trim() ?? '';
}

export function recoveryEnvironment(environment) {
	const inherited = { ...environment };
	for (const name of Object.keys(inherited)) {
		if (/^(COMPOSE_|BIFROST_|POSTGRES_|ELYGATE_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$|ENCRYPTION_KEY$|SETUP_TOKEN$|ENV_FILE$|BACKUP_ROOT$|BACKUP_DIR$)/.test(name)) {
			delete inherited[name];
		}
	}
	return inherited;
}

function writePrivate(filename, content) {
	writeFileSync(filename, content, { mode: 0o600 });
	chmodSync(filename, 0o600);
}

function nameCandidate(ctx) {
	const archive = join(ctx.work, 'candidate.tar');
	const fd = openSync(archive, 'wx', 0o600);
	try { command('docker', ['image', 'save', ctx.imageID], { env: ctx.env, stdio: ['ignore', fd, 'pipe'] }); }
	finally { closeSync(fd); }
	const layout = join(ctx.work, 'oci');
	mkdirSync(layout, { mode: 0o700 });
	command('tar', ['-xf', archive, '-C', layout], { env: ctx.env });
	const index = JSON.parse(readFileSync(join(layout, 'index.json'), 'utf8'));
	const descriptor = candidateManifest(index, hash => readFileSync(join(layout, 'blobs/sha256', hash)), ctx.imageID);
	check(descriptor, 'candidate must have an OCI manifest matching its config ID');
	const reference = `localhost/${ctx.prefix}@${descriptor.digest}`;
	ctx.loadedReference = reference;
	index.manifests = [{ ...descriptor, annotations: {
		'io.containerd.image.name': reference, 'org.opencontainers.image.ref.name': reference,
	} }];
	writePrivate(join(layout, 'index.json'), JSON.stringify(index));
	command('tar', ['-cf', archive, '-C', layout, '.'], { env: ctx.env });
	command('docker', ['image', 'load', '--input', archive], { env: ctx.env });
	const loaded = JSON.parse(command('docker', ['image', 'inspect', reference], { env: ctx.env }))[0];
	check(loaded.Id === ctx.imageID && loaded.Config.User === '1000:0', 'local manifest alias must retain candidate ID and non-root user');
	ctx.image = reference;
}

function compose(ctx, side, ...args) {
	return command('docker', ['compose', '--env-file', join(ctx.work, side, '.env'),
		'-f', join(ctx.work, side, 'docker-compose.yml'), ...args], { env: ctx.env });
}

function container(ctx, side, service = 'elygate') {
	return `${ctx.prefix}-${side}-${service}`;
}

function inspect(ctx, name) {
	return JSON.parse(command('docker', ['inspect', name], { env: ctx.env }))[0];
}

function sql(ctx, side, query) {
	return command('docker', ['exec', '-i', container(ctx, side, 'postgres'), 'psql',
		'-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', ctx.secrets.POSTGRES_USER,
		'-d', ctx.secrets.POSTGRES_DB], { env: ctx.env, input: query });
}

function databaseFingerprint(ctx, side) {
	const snapshot = sql(ctx, side, `SET TIME ZONE 'UTC';
SELECT format('SELECT jsonb_build_object(''table'', %L, ''rows'',
 COALESCE((SELECT jsonb_agg(row ORDER BY row::text) FROM
 (SELECT to_jsonb(t) AS row FROM %I.%I t) snapshot), ''[]''::jsonb));',
 schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\\gexec
SELECT format('SELECT jsonb_build_object(''sequence'', %L, ''last_value'', last_value,
 ''is_called'', is_called) FROM %I.%I;', sequence_schema || '.' || sequence_name,
 sequence_schema, sequence_name) FROM information_schema.sequences
ORDER BY sequence_schema, sequence_name
\\gexec
`);
	check(snapshot.includes('"table"') && snapshot.includes('"sequence"'), 'database fingerprint must include tables and sequences');
	check(!snapshot.includes(ctx.upstreamKey) && !snapshot.includes(ctx.key.value), 'database must not contain plaintext relay or Application Key credentials');
	return sha256(snapshot);
}

function prepareProject(ctx, side) {
	const directory = join(ctx.work, side);
	mkdirSync(directory, { mode: 0o700 });
	mkdirSync(join(directory, 'backups'), { mode: 0o700 });
	writePrivate(join(directory, '.env'), Object.entries({ ...ctx.secrets, ELYGATE_IMAGE: ctx.image })
		.map(([name, secret]) => `${name}=${secret}`).join('\n'));
	const template = JSON.parse(command('docker', ['compose', '--project-name', `${ctx.prefix}-${side}`,
		'--env-file', join(directory, '.env'), '-f', join(ctx.repo, 'examples/single-node-postgres/docker-compose.yml'),
		'config', '--format', 'json'], { env: ctx.env }));
	for (const service of ['elygate', 'postgres']) template.services[service].container_name = container(ctx, side, service);
	const gateway = template.services.elygate;
	gateway.ports = [{ target: 8080, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' }];
	gateway.extra_hosts = ['host.docker.internal:host-gateway'];
	gateway.environment.ELYGATE_RECOVERY_PASSWORD = ctx.secrets.ELYGATE_RECOVERY_PASSWORD;
	gateway.environment.ELYGATE_RECOVERY_UPSTREAM_KEY = ctx.upstreamKey;
	gateway.volumes.find(mount => mount.target === '/app/data/config.json').source = join(directory, 'config.json');
	if (side === 'target') {
		// Docker's image copy-up would violate the production restore's empty-volume contract.
		gateway.volumes.find(mount => mount.target === '/app/data').volume = { nocopy: true };
	}
	gateway.healthcheck.interval = '2s';
	gateway.healthcheck.start_period = '5s';
	writePrivate(join(directory, 'docker-compose.yml'), JSON.stringify(template));
	const config = recoveryConfig(ctx);
	writePrivate(join(directory, 'config.json'), JSON.stringify(config));
	chmodSync(join(directory, 'config.json'), 0o644);
	command('bash', [join(ctx.repo, 'scripts/production/single-node-preflight.sh'), directory], { env: ctx.env });
	ctx.projects.push(side);
}

function recoveryConfig(ctx) {
	const config = JSON.parse(readFileSync(join(ctx.repo, 'examples/single-node-postgres/config.json'), 'utf8'));
	config.providers = { openai: { keys: [{ name: 'recovery', value: 'env.ELYGATE_RECOVERY_UPSTREAM_KEY',
		models: ['gpt-4o-mini'], weight: 1 }],
		network_config: { base_url: `http://host.docker.internal:${ctx.upstream.address().port}`,
			max_retries: 0, allow_private_network: true } } };
	config.client.allowed_origins = [];
	config.governance = { auth_config: { is_enabled: true, admin_username: 'recovery',
		admin_password: 'env.ELYGATE_RECOVERY_PASSWORD' } };
	config.plugins = ['logging', 'governance'].map(name => ({ name, enabled: true, config: {} }));
	config.framework = { pricing: { pricing_url: 'file:///app/data/pricing.json',
		model_parameters_url: 'file:///app/data/parameters.json', mcp_library_url: 'file:///app/data/library.json' } };
	return config;
}

function prepareSourceFiles(ctx) {
	const files = { 'pricing.json': '{}', 'parameters.json': '{}', 'library.json': '{"servers":[]}',
		'recovery-marker': ctx.prefix };
	for (const [name, content] of Object.entries(files)) {
		const filename = join(ctx.work, name);
		writePrivate(filename, content);
		command('docker', ['cp', filename, `${container(ctx, 'source')}:/app/data/${name}`], { env: ctx.env });
	}
	// Only this test volume needs ownership preparation; production entrypoints stay unchanged.
	command('docker', ['run', '--rm', '--name', `${ctx.prefix}-prepare`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--user', '0',
		'--mount', `type=volume,source=${ctx.prefix}-source_elygate-runtime,target=/runtime,volume-nocopy`,
		'--entrypoint', '/bin/sh', ctx.image, '-ec',
		'chmod 644 /runtime/*.json; chmod 600 /runtime/recovery-marker; chown 1000:0 /runtime/*.json /runtime/recovery-marker'], { env: ctx.env });
}

function runtimeMarker(ctx, side) {
	return command('docker', ['run', '--rm', '--name', `${ctx.prefix}-marker-${side}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', '1000:0',
		'--mount', `type=volume,source=${ctx.prefix}-${side}_elygate-runtime,target=/runtime,volume-nocopy,readonly`,
		'--entrypoint', '/bin/sh', ctx.image, '-ec',
		'sha256sum /runtime/recovery-marker; stat -c "%u:%g:%a" /runtime/recovery-marker'], { env: ctx.env });
}

async function healthyOrigin(ctx, side) {
	for (let attempt = 0; attempt < 60; attempt++) {
		const gateway = inspect(ctx, container(ctx, side));
		check(gateway.State.Running && !gateway.State.OOMKilled && gateway.RestartCount === 0, 'gateway must stay running without restarts');
		const ports = gateway.NetworkSettings.Ports['8080/tcp'];
		check(ports?.length === 1 && ports[0].HostIp === '127.0.0.1' &&
			/^[0-9]+$/.test(ports[0].HostPort) && Number(ports[0].HostPort) > 0, 'expected unique loopback gateway port');
		if (gateway.State.Health?.Status === 'healthy') {
			const origin = `http://127.0.0.1:${ports[0].HostPort}`;
			const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5000) });
			const health = await response.json();
			check(response.ok && health.status === 'ok' && health.components.db_pings === 'ok', 'database-backed health must pass');
			return origin;
		}
		await delay(2000);
	}
	throw new RecoveryFailure('gateway readiness timed out');
}

function apiClient(origin) {
	let cookie = '';
	return async (route, options = {}) => {
		const response = await fetch(`${origin}${route}`, {
			method: options.method ?? 'GET', signal: AbortSignal.timeout(15_000),
			headers: { Origin: origin, 'Content-Type': 'application/json',
				...(cookie ? { Cookie: cookie } : {}), ...options.headers },
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		check(response.status === (options.status ?? 200), `unexpected HTTP status at ${route.split('?')[0]}`);
		const session = response.headers.get('set-cookie');
		if (session) cookie = session.split(';')[0];
		return response.status === 204 ? null : response.json();
	};
}

async function authenticatedClient(ctx, side) {
	const api = apiClient(await healthyOrigin(ctx, side));
	await api('/api/config', { status: 401 });
	await api('/api/session/login', { method: 'POST', body: {
		username: 'recovery', password: ctx.secrets.ELYGATE_RECOVERY_PASSWORD,
	} });
	check(await api('/api/version') === `v${ctx.commit}`, 'running version must match candidate source commit');
	return api;
}

async function auditSnapshot(api) {
	const chain = await api('/api/governance/audit-logs/verify');
	check(chain.valid === true && Number(chain.head_sequence) > 0 &&
		chain.checked_through_sequence === chain.head_sequence, 'full signed audit chain must verify');
	return { chain, publicKey: await api('/api/governance/audit-logs/public-key') };
}

function startUpstream(ctx) {
	ctx.relayHits = 0;
	ctx.inferenceHits = 0;
	ctx.upstream = createServer((request, response) => {
		request.resume();
		if (request.headers.authorization !== `Bearer ${ctx.upstreamKey}`) {
			response.writeHead(401).end();
			return;
		}
		response.setHeader('Content-Type', 'application/json');
		if (request.method === 'GET' && request.url === '/v1/models') {
			response.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-4o-mini', object: 'model', owned_by: 'recovery' }] }));
		} else if (request.method === 'POST' && request.url === '/v1/search') {
			ctx.relayHits++;
			response.end(JSON.stringify({ recovered: true, usage: { credits: 4, input_tokens: 50, output_tokens: 20 } }));
		} else if (request.method === 'POST' && request.url === '/v1/chat/completions') {
			ctx.inferenceHits++;
			response.end(JSON.stringify({ id: `chatcmpl-recovery-${ctx.inferenceHits}`, object: 'chat.completion',
				created: Math.floor(Date.now() / 1000), model: 'gpt-4o-mini',
				choices: [{ index: 0, message: { role: 'assistant', content: 'recovered' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } }));
		} else response.writeHead(404).end();
	});
	return new Promise((resolveListen, reject) => {
		ctx.upstream.once('error', reject);
		ctx.upstream.listen(0, '0.0.0.0', resolveListen);
	});
}

async function seedBusiness(ctx, api) {
	const relay = await api('/api/relays', { method: 'POST', status: 201, body: {
		name: 'recovery', base_url: `http://host.docker.internal:${ctx.upstream.address().port}`,
		auth: { type: 'bearer' }, credential: { value: ctx.upstreamKey },
		usage: { cost_per_request: 0.001, cost_per_unit: 0.01, units_path: 'usage.credits',
			input_tokens_path: 'usage.input_tokens', output_tokens_path: 'usage.output_tokens' },
		routes: [{ method: 'POST', path: '/v1/search' }],
	} });
	check(!JSON.stringify(relay).includes(ctx.upstreamKey), 'API must redact relay credential');
	const project = await api('/api/control-plane/projects', { method: 'POST', body: { name: 'Recovery' }, status: 201 });
	const application = await api(`/api/control-plane/projects/${project.id}/applications`,
		{ method: 'POST', body: { name: 'Recovery' }, status: 201 });
	ctx.application = { projectID: project.id, id: application.id };
	ctx.key = await api(`/api/control-plane/applications/${application.id}/keys`,
		{ method: 'POST', body: { name: 'Recovery' }, status: 201 });
	check(typeof ctx.key.value === 'string' && ctx.key.value.length > 0, 'Application Key must be returned');
	await api(`/api/governance/virtual-keys/${ctx.key.virtual_key_id}`, { method: 'PUT',
		body: { relay_grants: [{ relay_name: 'recovery' }] } });
}

async function verifyRelay(ctx, api) {
	const hits = ctx.relayHits;
	const response = await api('/relay/recovery/v1/search', { method: 'POST', body: {},
		headers: { 'x-bf-vk': ctx.key.value } });
	check(response.recovered === true && ctx.relayHits === hits + 1, 'retained key and decrypted credential must reach real upstream');
	for (let attempt = 0; attempt < 30; attempt++) {
		const logs = await api('/api/relay-logs?relay_names=recovery');
		const owned = logs.logs?.filter(row => row.virtual_key_id === ctx.key.virtual_key_id);
		if (owned?.length === ctx.relayHits) {
			check(owned.every(row => Math.abs(Number(row.cost) - 0.041) < 1e-9 &&
				row.input_tokens === 50 && row.output_tokens === 20), 'relay logs must preserve real request cost and tokens');
			return;
		}
		await delay(1000);
	}
	throw new RecoveryFailure('relay logs did not settle');
}

async function verifyUsageLedger(ctx, api) {
	const hits = ctx.inferenceHits;
	const response = await api('/v1/chat/completions', { method: 'POST',
		body: { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'recovery' }] },
		headers: { 'x-bf-vk': ctx.key.value } });
	check(response.choices?.[0]?.message?.content === 'recovered' && ctx.inferenceHits === hits + 1, 'real inference must reach isolated upstream');
	for (let attempt = 0; attempt < 30; attempt++) {
		const usage = await api('/api/control-plane/usage');
		const owned = usage.data?.filter(row => row.application_id === ctx.application.id &&
			row.project_id === ctx.application.projectID && row.virtual_key_id === ctx.key.virtual_key_id);
		if (owned?.length === ctx.inferenceHits) {
			check(owned.every(row => Number.isFinite(row.cost) && row.cost >= 0 &&
				row.prompt_tokens === 50 && row.output_tokens === 20 && row.total_tokens === 70),
			'real usage must preserve ownership and tokens');
			return;
		}
		await delay(1000);
	}
	throw new RecoveryFailure('owned usage ledger did not settle');
}

function encryptedStore(ctx, side) {
	const ciphertext = sql(ctx, side, "SELECT encryption_status, credential_value FROM config_relays WHERE name='recovery'");
	check(ciphertext.startsWith('encrypted|') && !ciphertext.includes(ctx.upstreamKey), 'relay credential must be encrypted at rest');
	for (const table of ['sessions', 'governance_virtual_keys']) {
		check(sql(ctx, side, `SELECT count(*) > 0 AND bool_and(encryption_status = 'encrypted') FROM ${table}`) === 't',
			'sessions and Application Keys must be encrypted at rest');
	}
	return sha256(ciphertext);
}

function stopGateway(ctx, side) {
	compose(ctx, side, 'stop', '-t', '40', 'elygate');
	const stopped = inspect(ctx, container(ctx, side)).State;
	check(stopped.Status === 'exited' && stopped.ExitCode === 0 && !stopped.OOMKilled, 'gateway must exit normally before freezing data');
}

function backupAndRestore(ctx) {
	stopGateway(ctx, 'source');
	ctx.frozenDatabase = databaseFingerprint(ctx, 'source');
	ctx.marker = runtimeMarker(ctx, 'source');
	check(ctx.marker === `${sha256(ctx.prefix)}  /runtime/recovery-marker\n1000:0:600`, 'source marker must have expected hash and ownership');
	command('bash', [join(ctx.repo, 'scripts/production/single-node-backup.sh'),
		join(ctx.work, 'source'), '--confirm-no-writers'], { env: ctx.env });
	const backups = readdirSync(join(ctx.work, 'source/backups'));
	check(backups.length === 1 && backups[0].startsWith('elygate-backup-'), 'expected one real backup');
	check(databaseFingerprint(ctx, 'source') === ctx.frozenDatabase, 'backup must not change source tables or sequences');
	compose(ctx, 'target', 'up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
	compose(ctx, 'target', 'create', '--no-deps', 'elygate');
	command('bash', [join(ctx.repo, 'scripts/production/single-node-restore.sh'),
		join(ctx.work, 'source/backups', backups[0]), join(ctx.work, 'target'), '--confirm-isolated-no-writers'], { env: ctx.env });
	check(!inspect(ctx, container(ctx, 'target')).State.Running, 'restore must leave target stopped');
	check(databaseFingerprint(ctx, 'target') === ctx.frozenDatabase, 'all restored table rows and sequences must match before startup');
	check(runtimeMarker(ctx, 'target') === ctx.marker, 'restored runtime hash, UID, GID and mode must match');
	check(encryptedStore(ctx, 'target') === ctx.ciphertext, 'restored credential ciphertext must match');
}

async function verifyRecovered(ctx) {
	compose(ctx, 'target', 'start', 'elygate');
	const api = await authenticatedClient(ctx, 'target');
	const keys = await api(`/api/control-plane/applications/${ctx.application.id}/keys`);
	check(keys.data?.some(key => key.virtual_key_id === ctx.key.virtual_key_id), 'restored Application Key binding must exist');
	const restoredAudit = await auditSnapshot(api);
	check(JSON.stringify(restoredAudit.publicKey) === JSON.stringify(ctx.audit.publicKey), 'audit signing public key must survive restore');
	check(Number(restoredAudit.chain.head_sequence) >= Number(ctx.audit.chain.head_sequence), 'restored audit history must not shrink');
	const events = await api('/api/control-plane/audit-events?limit=100');
	check(ctx.auditEvents.data.every(before => events.data?.some(after => JSON.stringify(after) === JSON.stringify(before))),
		'retained audit feed must preserve original events');
	await verifyRelay(ctx, api);
	await verifyUsageLedger(ctx, api);
	await api('/api/control-plane/projects', { method: 'POST', body: { name: 'After recovery' }, status: 201 });
	const continuedAudit = await auditSnapshot(api);
	check(Number(continuedAudit.chain.head_sequence) > Number(restoredAudit.chain.head_sequence), 'restored audit sequence must accept new signed events');
	await api('/api/session/logout', { method: 'POST' });
	await api('/api/config', { status: 401 });
	stopGateway(ctx, 'target');
	check(databaseFingerprint(ctx, 'target') !== ctx.frozenDatabase, 'target must have persisted new writes');
	check(databaseFingerprint(ctx, 'source') === ctx.frozenDatabase, 'target writes must not change source rows or sequences');
	check(runtimeMarker(ctx, 'source') === ctx.marker, 'source runtime marker must remain unchanged');
	check(inspect(ctx, container(ctx, 'source')).State.Status === 'exited', 'source must remain stopped');
}

async function cleanup(ctx) {
	if (!ctx.localDocker) {
		rmSync(ctx.work, { recursive: true, force: true });
		return;
	}
	let cleaned = true;
	if (ctx.upstream) {
		ctx.upstream.closeAllConnections();
		await new Promise(resolveClose => ctx.upstream.close(resolveClose));
	}
	for (const suffix of ['prepare', 'marker-source', 'marker-target']) {
		try {
			const existing = command('docker', ['container', 'ls', '--all', '--quiet',
				'--filter', `name=^/${ctx.prefix}-${suffix}$`], { env: ctx.env });
			if (existing) command('docker', ['rm', '--force', '--volumes', `${ctx.prefix}-${suffix}`], { env: ctx.env });
		} catch { cleaned = false; }
	}
	for (const side of [...ctx.projects].reverse()) {
		try { compose(ctx, side, 'down', '--volumes', '--remove-orphans', '--timeout', '40'); }
		catch { cleaned = false; }
	}
	for (const side of ctx.projects) {
		for (const resource of ['container', 'volume', 'network']) {
			try {
				check(command('docker', [resource, 'ls', '--quiet', '--filter',
					`label=com.docker.compose.project=${ctx.prefix}-${side}`,
					...(resource === 'container' ? ['--all'] : [])], { env: ctx.env }) === '', 'test resources must not remain');
			} catch { cleaned = false; }
		}
	}
	if (ctx.loadedReference) {
		try { command('docker', ['image', 'rm', ctx.loadedReference], { env: ctx.env }); }
		catch { cleaned = false; }
	}
	check(cleaned, 'private resource cleanup failed; recovery is not accepted');
	rmSync(ctx.work, { recursive: true, force: true });
}

async function main(args) {
	try { validateCandidate(args); }
	catch { console.error('expected immutable image ID and full Git commit SHA'); process.exitCode = 2; return; }
	process.umask(0o077);
	const secret = () => randomBytes(32).toString('hex');
	const ctx = { imageID: args[0], commit: args[1], env: recoveryEnvironment(process.env), projects: [],
		repo: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
		prefix: `elygate-recovery-${randomBytes(8).toString('hex')}`, upstreamKey: secret(),
		work: mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'elygate-recovery-')),
		secrets: { ENCRYPTION_KEY: secret(), SETUP_TOKEN: secret(), POSTGRES_USER: 'recovery',
			POSTGRES_DB: 'recovery', POSTGRES_PASSWORD: secret(), ELYGATE_RECOVERY_PASSWORD: `Aa1!${secret()}` } };
	let phase = 'candidate identity';
	try {
		const context = JSON.parse(command('docker', ['context', 'inspect'], { env: ctx.env }));
		check(context.length === 1 && context[0].Endpoints?.docker?.Host?.startsWith('unix:///'),
			'recovery smoke requires a local Docker Unix socket');
		ctx.localDocker = true;
		nameCandidate(ctx);
		phase = 'isolated project preflight';
		await startUpstream(ctx);
		for (const side of ['source', 'target']) prepareProject(ctx, side);
		phase = 'source startup';
		compose(ctx, 'source', 'up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
		compose(ctx, 'source', 'create', '--no-deps', 'elygate');
		prepareSourceFiles(ctx);
		compose(ctx, 'source', 'start', 'elygate');
		const api = await authenticatedClient(ctx, 'source');
		phase = 'source business persistence';
		await seedBusiness(ctx, api);
		await verifyRelay(ctx, api);
		await verifyUsageLedger(ctx, api);
		ctx.audit = await auditSnapshot(api);
		ctx.auditEvents = await api('/api/control-plane/audit-events?limit=100');
		check(ctx.auditEvents.data?.some(event => event.resource_id === ctx.application.projectID) &&
			ctx.auditEvents.data.some(event => event.resource_id === ctx.application.id), 'audit feed must contain project and application mutations');
		ctx.ciphertext = encryptedStore(ctx, 'source');
		phase = 'production backup and isolated restore';
		backupAndRestore(ctx);
		phase = 'recovered business continuity';
		await verifyRecovered(ctx);
	} catch (error) {
		console.error(`FAIL recovery ${phase}: ${error instanceof RecoveryFailure ? error.message : 'unexpected runtime error (details suppressed)'}`);
		process.exitCode = 1;
	} finally {
		try { await cleanup(ctx); }
		catch { console.error('FAIL recovery cleanup (details suppressed)'); process.exitCode = 1; }
	}
	if (!process.exitCode) console.log('PASS recovery: candidate identity, real backup/restore, tables/sequences, file ownership, encrypted credentials, Application Key, Usage, signed Audit, source unchanged and cleanup');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
