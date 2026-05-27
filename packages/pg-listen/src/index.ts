/**
 * @elygate/pg-listen - zero-dependency PostgreSQL LISTEN/NOTIFY client.
 *
 * Implements PostgreSQL Wire Protocol directly via Bun.connect() native TCP.
 * Supports TLS negotiation, MD5, Cleartext, and SCRAM-SHA-256 authentication.
 */
import { createHash, createHmac, randomBytes } from "crypto";

// ---- Types ----

interface PgConnectOptions {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	tls: ResolvedTlsOptions | null;
}

type PgLogger = Partial<Pick<typeof console, "debug" | "info" | "warn" | "error">>;

type PgSslMode = "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full" | "no-verify";

type PgTlsOptions = boolean | Bun.TLSOptions;

type QueryKind = "listen" | "notify" | "health";
type Bytes = Uint8Array<ArrayBufferLike>;
type PgSocket = Bun.Socket<unknown>;

interface ResolvedTlsOptions {
	tls: PgTlsOptions;
	allowPlainFallback: boolean;
}

interface PendingQuery {
	sql: string;
	kind: QueryKind;
	resolve(): void;
	reject(error: Error): void;
	error: Error | null;
}

export type NotifyHandler = (channel: string, payload: string) => void;

export interface PgListenerHealth {
	status: "connecting" | "connected" | "reconnecting" | "closed" | "error";
	connected: boolean;
	listeningChannels: string[];
	queuedQueries: number;
	activeQuery: boolean;
	reconnectAttempts: number;
	lastConnectedAt: number | null;
	lastMessageAt: number | null;
	lastNotificationAt: number | null;
	lastError: string | null;
}

export interface PgListenerEvents {
	connected: PgListenerHealth;
	close: { willReconnect: boolean; error?: Error };
	error: Error;
	health: PgListenerHealth;
	notification: { channel: string; payload: string };
	reconnect: { attempt: number; delayMs: number };
}

export interface PgListenerOptions {
	channels?: string[];
	onNotify?: NotifyHandler;
	tls?: PgTlsOptions;
	ssl?: PgTlsOptions;
	sslMode?: PgSslMode;
	reconnectDelayMs?: number | ((attempt: number) => number);
	healthCheckIntervalMs?: number;
	logger?: PgLogger | false;
}

export interface PgListenerHandle {
	close(): void;
	notify(channel: string, payload?: string): Promise<void>;
	getHealth(): PgListenerHealth;
	on<K extends keyof PgListenerEvents>(
		event: K,
		handler: (payload: PgListenerEvents[K]) => void
	): () => void;
	off<K extends keyof PgListenerEvents>(
		event: K,
		handler: (payload: PgListenerEvents[K]) => void
	): void;
}

// ---- Constants ----

const AUTH_OK = 0;
const AUTH_CLEARTEXT = 3;
const AUTH_MD5 = 5;
const AUTH_SASL = 10;
const AUTH_SASL_CONTINUE = 11;
const AUTH_SASL_FINAL = 12;

const SSL_REQUEST_CODE = 80877103;
const PROTOCOL_VERSION_3 = 196608;
const DEFAULT_RECONNECT_DELAY_MS = 3000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30000;
const MAX_NOTIFY_PAYLOAD_BYTES = 7999;

// ---- Event Emitter ----

class TypedEventEmitter<Events extends object> {
	private listeners = new Map<keyof Events, Set<(payload: Events[keyof Events]) => void>>();

	constructor(private readonly onListenerError: (error: Error) => void) {}

	on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
		const bucket = this.listeners.get(event) ?? new Set();
		bucket.add(handler as (payload: Events[keyof Events]) => void);
		this.listeners.set(event, bucket);
		return () => this.off(event, handler);
	}

	off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
		const bucket = this.listeners.get(event);
		if (!bucket) return;
		bucket.delete(handler as (payload: Events[keyof Events]) => void);
		if (bucket.size === 0) this.listeners.delete(event);
	}

	emit<K extends keyof Events>(event: K, payload: Events[K]): void {
		const bucket = this.listeners.get(event);
		if (!bucket) return;
		for (const handler of [...bucket]) {
			try {
				handler(payload);
			} catch (err) {
				this.onListenerError(toError(err));
			}
		}
	}
}

// ---- DSN and TLS Parsing ----

function parseDSN(url: string, options: PgListenerOptions = {}): PgConnectOptions {
	const u = new URL(url);
	const host = u.hostname;
	return {
		host,
		port: Number(u.port) || 5432,
		database: decodeURIComponent(u.pathname.slice(1)),
		user: decodeURIComponent(u.username),
		password: decodeURIComponent(u.password),
		tls: resolveTlsOptions(u, host, options)
	};
}

function resolveTlsOptions(url: URL, host: string, options: PgListenerOptions): ResolvedTlsOptions | null {
	const explicitTls = options.tls ?? options.ssl;
	if (explicitTls !== undefined) {
		if (explicitTls === false) return null;
		return { tls: normalizeTlsOptions(explicitTls, host), allowPlainFallback: false };
	}

	const sslMode = (options.sslMode ?? url.searchParams.get("sslmode") ?? "").toLowerCase() as PgSslMode | "";
	const sslFlag = (url.searchParams.get("ssl") ?? "").toLowerCase();

	if (sslMode === "disable" || sslFlag === "false" || sslFlag === "0") return null;
	if (!sslMode && !sslFlag) return null;

	const tlsFromUrl = buildTlsOptionsFromUrl(url, host);
	if (sslMode === "allow" || sslMode === "prefer") {
		return { tls: tlsFromUrl, allowPlainFallback: true };
	}
	if (sslMode === "verify-ca" || sslMode === "verify-full") {
		return {
			tls: { ...asTlsObject(tlsFromUrl, host), rejectUnauthorized: true },
			allowPlainFallback: false
		};
	}
	if (sslMode === "no-verify" || sslMode === "require" || sslFlag === "true" || sslFlag === "1") {
		return {
			tls: { ...asTlsObject(tlsFromUrl, host), rejectUnauthorized: false },
			allowPlainFallback: false
		};
	}
	return null;
}

function buildTlsOptionsFromUrl(url: URL, host: string): Bun.TLSOptions {
	const tls: Bun.TLSOptions = { serverName: host };
	const rootCert = url.searchParams.get("sslrootcert");
	const cert = url.searchParams.get("sslcert");
	const key = url.searchParams.get("sslkey");
	if (rootCert) tls.ca = Bun.file(rootCert);
	if (cert) tls.cert = Bun.file(cert);
	if (key) tls.key = Bun.file(key);
	return tls;
}

function normalizeTlsOptions(tls: PgTlsOptions, host: string): PgTlsOptions {
	if (tls === true) return { serverName: host };
	return { serverName: host, ...tls };
}

function asTlsObject(tls: PgTlsOptions, host: string): Bun.TLSOptions {
	if (tls === true) return { serverName: host };
	return { serverName: host, ...tls };
}

// ---- SQL Utilities ----

function quoteIdentifier(identifier: string): string {
	if (!identifier || identifier.includes("\0")) {
		throw new Error("PostgreSQL identifier must be non-empty and cannot contain null bytes");
	}
	return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
	if (value.includes("\0")) {
		throw new Error("PostgreSQL string literal cannot contain null bytes");
	}
	return `'${value.replace(/'/g, "''")}'`;
}

function buildListenQuery(channels: string[]): string {
	return channels.map((channel) => `LISTEN ${quoteIdentifier(channel)}`).join("; ");
}

function buildNotifyQuery(channel: string, payload = ""): string {
	const payloadBytes = new TextEncoder().encode(payload).byteLength;
	if (payloadBytes > MAX_NOTIFY_PAYLOAD_BYTES) {
		throw new Error(`PostgreSQL NOTIFY payload must be shorter than 8000 bytes; got ${payloadBytes}`);
	}
	return `SELECT pg_notify(${quoteLiteral(channel)}, ${quoteLiteral(payload)})`;
}

// ---- Byte Utilities ----

function allocBuffer(size: number): DataView {
	return new DataView(new ArrayBuffer(size));
}

function encodeString(s: string): Bytes {
	return new TextEncoder().encode(s);
}

function concatBytes(...parts: Bytes[]): Bytes {
	const total = parts.reduce((acc, p) => acc + p.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function toBytes(rawData: ArrayBuffer | ArrayBufferView): Bytes {
	if (rawData instanceof Uint8Array) return rawData;
	if (rawData instanceof ArrayBuffer) return new Uint8Array(rawData);
	return new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
}

function readInt32BE(buf: Bytes, offset: number): number {
	return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getInt32(offset);
}

function indexOfZero(buf: Bytes, from: number): number {
	for (let i = from; i < buf.length; i++) {
		if (buf[i] === 0) return i;
	}
	return -1;
}

function sliceToString(buf: Bytes, start: number, end: number): string {
	return new TextDecoder().decode(buf.subarray(start, end));
}

function toError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

// ---- PostgreSQL Wire Protocol Message Builders ----

function buildStartupMessage(user: string, database: string): Bytes {
	const params = encodeString(`user\0${user}\0database\0${database}\0\0`);
	const totalLen = 8 + params.length;
	const header = allocBuffer(8);
	header.setInt32(0, totalLen);
	header.setInt32(4, PROTOCOL_VERSION_3);
	return concatBytes(new Uint8Array(header.buffer), params);
}

function buildSSLRequest(): Bytes {
	const header = allocBuffer(8);
	header.setInt32(0, 8);
	header.setInt32(4, SSL_REQUEST_CODE);
	return new Uint8Array(header.buffer);
}

function buildTerminateMessage(): Bytes {
	const header = allocBuffer(5);
	header.setUint8(0, 0x58); // 'X'
	header.setInt32(1, 4);
	return new Uint8Array(header.buffer);
}

function buildMD5AuthResponse(user: string, password: string, salt: Bytes): Bytes {
	const inner = createHash("md5").update(password + user).digest("hex");
	const outer = "md5" + createHash("md5").update(inner).update(salt).digest("hex");
	const payload = encodeString(outer + "\0");
	const totalLen = 4 + payload.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70); // 'p'
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), payload);
}

function buildCleartextAuthResponse(password: string): Bytes {
	const payload = encodeString(password + "\0");
	const totalLen = 4 + payload.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70);
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), payload);
}

function buildSimpleQuery(sqlText: string): Bytes {
	const payload = encodeString(sqlText + "\0");
	const totalLen = 4 + payload.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x51); // 'Q'
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), payload);
}

// ---- SCRAM-SHA-256 Utilities ----

function hi(password: string, salt: Buffer, iterations: number): Buffer {
	let u = createHmac("sha256", password).update(salt).update(Buffer.from([0, 0, 0, 1])).digest();
	const result = Buffer.from(u);
	for (let i = 1; i < iterations; i++) {
		u = createHmac("sha256", password).update(u).digest();
		for (let j = 0; j < result.length; j++) {
			result[j]! ^= u[j]!;
		}
	}
	return result;
}

function buildSASLInitialResponse(mechanism: string, clientFirstMessage: string): Bytes {
	const mechBytes = encodeString(mechanism + "\0");
	const msgBytes = encodeString(clientFirstMessage);
	const totalPayloadLen = 4 + mechBytes.length + 4 + msgBytes.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70);
	header.setInt32(1, totalPayloadLen);
	const msgLenBuf = allocBuffer(4);
	msgLenBuf.setInt32(0, msgBytes.length);
	return concatBytes(
		new Uint8Array(header.buffer),
		mechBytes,
		new Uint8Array(msgLenBuf.buffer),
		msgBytes
	);
}

function buildSASLResponse(clientFinalMessage: string): Bytes {
	const msgBytes = encodeString(clientFinalMessage);
	const totalLen = 4 + msgBytes.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70);
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), msgBytes);
}

// ---- Main Entry ----

export function createPgListener(
	databaseUrl: string,
	channels: string[],
	onNotify: NotifyHandler,
	options?: PgListenerOptions
): PgListenerHandle;
export function createPgListener(databaseUrl: string, options?: PgListenerOptions): PgListenerHandle;
export function createPgListener(
	databaseUrl: string,
	channelsOrOptions: string[] | PgListenerOptions = [],
	onNotify?: NotifyHandler,
	maybeOptions: PgListenerOptions = {}
): PgListenerHandle {
	const options: PgListenerOptions = Array.isArray(channelsOrOptions)
		? { ...maybeOptions, channels: channelsOrOptions, onNotify: onNotify ?? maybeOptions.onNotify }
		: channelsOrOptions;

	const opts = parseDSN(databaseUrl, options);
	const logger = options.logger === false ? null : options.logger ?? console;
	const subscribedChannels = new Set(options.channels ?? []);
	const reconnectDelay = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
	const healthCheckIntervalMs = options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;

	let status: PgListenerHealth["status"] = "connecting";
	let closed = false;
	let startupReady = false;
	let readyForQuery = false;
	let pending: Bytes = new Uint8Array(0);
	let activeSocket: PgSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let healthTimer: ReturnType<typeof setInterval> | null = null;
	let activeQuery: PendingQuery | null = null;
	const queryQueue: PendingQuery[] = [];
	let reconnectAttempts = 0;
	let lastConnectedAt: number | null = null;
	let lastMessageAt: number | null = null;
	let lastNotificationAt: number | null = null;
	let lastError: string | null = null;

	let connectionPhase: "socket" | "ssl-request" | "tls-handshake" | "startup" | "ready" = "socket";

	let scramClientNonce = "";
	let scramClientFirstBare = "";
	let scramServerFirstMessage = "";

	const emitter = new TypedEventEmitter<PgListenerEvents>((error) => reportError(error, false));

	const socketHandler: Bun.SocketHandler<unknown> = {
		open(socket) {
			activeSocket = socket;
			if (connectionPhase === "tls-handshake") return;
			if (opts.tls) {
				connectionPhase = "ssl-request";
				socket.write(buildSSLRequest());
				return;
			}
			startPostgresStartup(socket);
		},
		handshake(socket, success, authorizationError) {
			activeSocket = socket;
			if (!success) {
				const error = authorizationError ?? new Error("TLS handshake failed");
				reportError(error);
				socket.end();
				return;
			}
			startPostgresStartup(socket);
		},
		data(socket, rawData) {
			lastMessageAt = Date.now();
			const chunk = toBytes(rawData);
			if (connectionPhase === "ssl-request") {
				processSSLResponse(socket, chunk);
				return;
			}
			pending = concatBytes(pending, chunk);
			processMessages(socket);
		},
		error(_socket, error) {
			reportError(error);
		},
		connectError(_socket, error) {
			reportError(error);
		},
		close(_socket, error) {
			handleSocketClose(error);
		}
	};

	function getHealth(): PgListenerHealth {
		return {
			status,
			connected: status === "connected",
			listeningChannels: [...subscribedChannels],
			queuedQueries: queryQueue.length,
			activeQuery: activeQuery !== null,
			reconnectAttempts,
			lastConnectedAt,
			lastMessageAt,
			lastNotificationAt,
			lastError
		};
	}

	function emitHealth(): void {
		emitter.emit("health", getHealth());
	}

	function setStatus(next: PgListenerHealth["status"]): void {
		status = next;
		emitHealth();
	}

	function reportError(error: Error, emit = true): void {
		lastError = error.message;
		logger?.error?.("[pg-listen]", error);
		if (emit) emitter.emit("error", error);
		emitHealth();
	}

	function resetConnectionState(): void {
		startupReady = false;
		readyForQuery = false;
		pending = new Uint8Array(0);
		activeQuery = null;
		connectionPhase = "socket";
		scramClientNonce = "";
		scramClientFirstBare = "";
		scramServerFirstMessage = "";
	}

	function startPostgresStartup(socket: PgSocket): void {
		connectionPhase = "startup";
		socket.write(buildStartupMessage(opts.user, opts.database));
	}

	function processSSLResponse(socket: PgSocket, chunk: Bytes): void {
		if (chunk.length === 0) return;
		const response = String.fromCharCode(chunk[0]!);
		if (response === "S") {
			connectionPhase = "tls-handshake";
			const [, tlsSocket] = socket.upgradeTLS({
				tls: opts.tls?.tls ?? true,
				socket: socketHandler
			});
			activeSocket = tlsSocket;
			if (chunk.length > 1) {
				pending = concatBytes(pending, chunk.subarray(1));
			}
			return;
		}

		if (response === "N" && opts.tls?.allowPlainFallback) {
			logger?.warn?.("[pg-listen] PostgreSQL server rejected SSL; falling back to plain TCP");
			startPostgresStartup(socket);
			if (chunk.length > 1) {
				pending = concatBytes(pending, chunk.subarray(1));
				processMessages(socket);
			}
			return;
		}

		const error = new Error(response === "N" ? "PostgreSQL server does not support SSL" : `Unexpected SSL response: ${response}`);
		reportError(error);
		socket.end();
	}

	function registerListenChannels(): void {
		if (subscribedChannels.size === 0) {
			markConnected();
			return;
		}
		const sql = buildListenQuery([...subscribedChannels]);
		void enqueueQuery(sql, "listen", true)
			.then(markConnected)
			.catch((error) => {
				reportError(error);
				activeSocket?.end();
			});
	}

	function markConnected(): void {
		if (closed) return;
		connectionPhase = "ready";
		lastConnectedAt = Date.now();
		reconnectAttempts = 0;
		setStatus("connected");
		startHealthTimer();
		emitter.emit("connected", getHealth());
		logger?.info?.(`[pg-listen] Connected and subscribed: ${[...subscribedChannels].join(", ") || "(none)"}`);
	}

	function enqueueQuery(sql: string, kind: QueryKind, front = false): Promise<void> {
		if (closed) return Promise.reject(new Error("PostgreSQL listener is closed"));
		return new Promise((resolve, reject) => {
			const pendingQuery: PendingQuery = { sql, kind, resolve, reject, error: null };
			if (front) queryQueue.unshift(pendingQuery);
			else queryQueue.push(pendingQuery);
			flushQueryQueue();
		});
	}

	function flushQueryQueue(): void {
		if (closed || !activeSocket || !readyForQuery || activeQuery || queryQueue.length === 0) return;
		activeQuery = queryQueue.shift()!;
		readyForQuery = false;
		activeSocket.write(buildSimpleQuery(activeQuery.sql));
		emitHealth();
	}

	function rejectActiveQuery(error: Error): void {
		if (!activeQuery) return;
		activeQuery.reject(error);
		activeQuery = null;
	}

	function rejectQueuedQueries(error: Error): void {
		rejectActiveQuery(error);
		while (queryQueue.length > 0) {
			queryQueue.shift()!.reject(error);
		}
	}

	function processReadyForQuery(): void {
		readyForQuery = true;
		if (activeQuery) {
			const completed = activeQuery;
			activeQuery = null;
			if (completed.error) completed.reject(completed.error);
			else completed.resolve();
			flushQueryQueue();
			return;
		}

		if (!startupReady) {
			startupReady = true;
			registerListenChannels();
			return;
		}
		flushQueryQueue();
	}

	function processMessages(socket: PgSocket): void {
		while (pending.length >= 5) {
			const msgType = pending[0]!;
			const msgLen = readInt32BE(pending, 1);
			const totalLen = 1 + msgLen;

			if (pending.length < totalLen) break;

			const body = pending.subarray(5, totalLen);

			switch (msgType) {
				case 0x52:
					handleAuthentication(socket, body);
					break;
				case 0x5a:
					processReadyForQuery();
					break;
				case 0x41:
					handleNotification(body);
					break;
				case 0x45:
					handlePostgresError(body);
					break;
			}

			pending = pending.subarray(totalLen);
		}
	}

	function handleAuthentication(socket: PgSocket, body: Bytes): void {
		const authType = readInt32BE(body, 0);
		if (authType === AUTH_OK) return;
		if (authType === AUTH_MD5) {
			const salt = body.subarray(4, 8);
			socket.write(buildMD5AuthResponse(opts.user, opts.password, salt));
			return;
		}
		if (authType === AUTH_CLEARTEXT) {
			socket.write(buildCleartextAuthResponse(opts.password));
			return;
		}
		if (authType === AUTH_SASL) {
			const mechList = sliceToString(body, 4, body.length);
			if (!mechList.includes("SCRAM-SHA-256")) {
				reportError(new Error("PostgreSQL server does not support SCRAM-SHA-256"));
				socket.end();
				return;
			}
			scramClientNonce = randomBytes(18).toString("base64");
			scramClientFirstBare = `n=,r=${scramClientNonce}`;
			socket.write(buildSASLInitialResponse("SCRAM-SHA-256", `n,,${scramClientFirstBare}`));
			return;
		}
		if (authType === AUTH_SASL_CONTINUE) {
			handleSaslContinue(socket, body);
			return;
		}
		if (authType === AUTH_SASL_FINAL) return;
		reportError(new Error(`Unsupported PostgreSQL auth type: ${authType}`));
		socket.end();
	}

	function handleSaslContinue(socket: PgSocket, body: Bytes): void {
		scramServerFirstMessage = sliceToString(body, 4, body.length);
		const params: Record<string, string> = {};
		for (const part of scramServerFirstMessage.split(",")) {
			const eq = part.indexOf("=");
			if (eq > 0) params[part.substring(0, eq)] = part.substring(eq + 1);
		}
		const serverNonce = params["r"] || "";
		const salt = Buffer.from(params["s"] || "", "base64");
		const iterations = parseInt(params["i"] || "4096", 10);

		if (!serverNonce.startsWith(scramClientNonce)) {
			reportError(new Error("SCRAM server nonce mismatch"));
			socket.end();
			return;
		}

		const saltedPassword = hi(opts.password, salt, iterations);
		const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
		const storedKey = createHash("sha256").update(clientKey).digest();
		const channelBinding = Buffer.from("n,,").toString("base64");
		const clientFinalNoProof = `c=${channelBinding},r=${serverNonce}`;
		const authMessage = `${scramClientFirstBare},${scramServerFirstMessage},${clientFinalNoProof}`;
		const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
		const clientProof = Buffer.alloc(clientKey.length);
		for (let i = 0; i < clientKey.length; i++) {
			clientProof[i] = clientKey[i]! ^ clientSignature[i]!;
		}
		socket.write(buildSASLResponse(`${clientFinalNoProof},p=${clientProof.toString("base64")}`));
	}

	function handleNotification(body: Bytes): void {
		let pos = 4;
		const chEnd = indexOfZero(body, pos);
		if (chEnd < 0) return;
		const channel = sliceToString(body, pos, chEnd);
		pos = chEnd + 1;
		const plEnd = indexOfZero(body, pos);
		if (plEnd < 0) return;
		const payload = sliceToString(body, pos, plEnd);

		lastNotificationAt = Date.now();
		try {
			options.onNotify?.(channel, payload);
		} catch (err) {
			reportError(toError(err));
		}
		emitter.emit("notification", { channel, payload });
		emitHealth();
	}

	function handlePostgresError(body: Bytes): void {
		const text = sliceToString(body, 0, body.length).replace(/\0/g, " | ");
		const error = new Error(text);
		if (activeQuery) {
			activeQuery.error = error;
			return;
		}
		reportError(error);
	}

	function connect(): void {
		if (closed) return;
		resetConnectionState();
		setStatus(reconnectAttempts > 0 ? "reconnecting" : "connecting");

		void Bun.connect({
			hostname: opts.host,
			port: opts.port,
			socket: socketHandler
		}).then((socket) => {
			activeSocket = socket;
		}).catch((err) => {
			reportError(toError(err));
			if (!closed) scheduleReconnect();
		});
	}

	function resolveReconnectDelay(): number {
		return typeof reconnectDelay === "function" ? reconnectDelay(reconnectAttempts) : reconnectDelay;
	}

	function scheduleReconnect(error?: Error): void {
		if (closed) return;
		stopHealthTimer();
		reconnectAttempts += 1;
		const delayMs = resolveReconnectDelay();
		setStatus("reconnecting");
		emitter.emit("reconnect", { attempt: reconnectAttempts, delayMs });
		if (error) reportError(error);
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(connect, delayMs);
	}

	function handleSocketClose(error?: Error): void {
		activeSocket = null;
		readyForQuery = false;
		stopHealthTimer();
		if (activeQuery) {
			rejectActiveQuery(error ?? new Error("PostgreSQL connection closed before query completed"));
		}
		if (closed) {
			setStatus("closed");
			rejectQueuedQueries(new Error("PostgreSQL listener is closed"));
			emitter.emit("close", { willReconnect: false, ...(error && { error }) });
			return;
		}
		emitter.emit("close", { willReconnect: true, ...(error && { error }) });
		scheduleReconnect(error);
	}

	function startHealthTimer(): void {
		stopHealthTimer();
		if (healthCheckIntervalMs <= 0) return;
		healthTimer = setInterval(() => {
			if (closed || status !== "connected") return;
			if (activeQuery || queryQueue.some((query) => query.kind === "health")) return;
			enqueueQuery("SELECT 1", "health").catch((error) => {
				reportError(error);
				activeSocket?.end();
			});
		}, healthCheckIntervalMs);
	}

	function stopHealthTimer(): void {
		if (healthTimer) clearInterval(healthTimer);
		healthTimer = null;
	}

	connect();

	return {
		close() {
			if (closed) return;
			closed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = null;
			stopHealthTimer();
			try {
				activeSocket?.write(buildTerminateMessage());
			} catch {
				// Ignore close-time write failures.
			}
			activeSocket?.end();
			rejectQueuedQueries(new Error("PostgreSQL listener is closed"));
			if (!activeSocket) setStatus("closed");
		},
		notify(channel: string, payload = "") {
			return enqueueQuery(buildNotifyQuery(channel, payload), "notify");
		},
		getHealth,
		on(event, handler) {
			return emitter.on(event, handler);
		},
		off(event, handler) {
			emitter.off(event, handler);
		}
	};
}

export const __pgListenInternals = {
	buildListenQuery,
	buildNotifyQuery,
	quoteIdentifier,
	quoteLiteral,
	parseDSN,
	resolveTlsOptions
};
