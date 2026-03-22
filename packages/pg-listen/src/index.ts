/**
 * @elygate/pg-listen — Zero-dependency PostgreSQL LISTEN/NOTIFY client
 *
 * Implements PostgreSQL Wire Protocol directly via Bun.connect() native TCP.
 * Supports MD5, Cleartext, and SCRAM-SHA-256 authentication.
 * No third-party dependencies.
 */
import { createHash, createHmac, randomBytes } from "crypto";

// ---- Types ----

interface PgConnectOptions {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
}

export type NotifyHandler = (channel: string, payload: string) => void;

export interface PgListenerHandle {
	close(): void;
}

// ---- DSN Parsing ----

function parseDSN(url: string): PgConnectOptions {
	const u = new URL(url);
	return {
		host: u.hostname,
		port: Number(u.port) || 5432,
		database: u.pathname.slice(1),
		user: decodeURIComponent(u.username),
		password: decodeURIComponent(u.password)
	};
}

// ---- Byte Utilities ----

function allocBuffer(size: number): DataView {
	return new DataView(new ArrayBuffer(size));
}

function encodeString(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const total = parts.reduce((acc, p) => acc + p.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

// ---- PostgreSQL Wire Protocol Message Builders ----

function buildStartupMessage(user: string, database: string): Uint8Array {
	const params = encodeString(`user\0${user}\0database\0${database}\0\0`);
	const totalLen = 8 + params.length;
	const header = allocBuffer(8);
	header.setInt32(0, totalLen);
	header.setInt32(4, 196608); // Protocol version 3.0
	return concatBytes(new Uint8Array(header.buffer), params);
}

function buildMD5AuthResponse(user: string, password: string, salt: Uint8Array): Uint8Array {
	const inner = createHash("md5").update(password + user).digest("hex");
	const outer = "md5" + createHash("md5").update(inner).update(salt).digest("hex");
	const payload = encodeString(outer + "\0");
	const totalLen = 4 + payload.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70); // 'p'
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), payload);
}

function buildCleartextAuthResponse(password: string): Uint8Array {
	const payload = encodeString(password + "\0");
	const totalLen = 4 + payload.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70);
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), payload);
}

function buildSimpleQuery(sqlText: string): Uint8Array {
	const payload = encodeString(sqlText + "\0");
	const totalLen = 4 + payload.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x51); // 'Q'
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), payload);
}

// ---- SCRAM-SHA-256 Utilities ----

function hi(password: string, salt: Buffer, iterations: number): Buffer {
	// PBKDF2 with HMAC-SHA-256 — Hi(str, salt, i) per RFC 5802
	let u = createHmac("sha256", password).update(salt).update(Buffer.from([0, 0, 0, 1])).digest();
	let result = Buffer.from(u);
	for (let i = 1; i < iterations; i++) {
		u = createHmac("sha256", password).update(u).digest();
		for (let j = 0; j < result.length; j++) {
			result[j]! ^= u[j]!;
		}
	}
	return result;
}

function buildSASLInitialResponse(mechanism: string, clientFirstMessage: string): Uint8Array {
	const mechBytes = encodeString(mechanism + "\0");
	const msgBytes = encodeString(clientFirstMessage);
	// p(1) + len(4) + mechanism\0 + msgLen(4) + msg
	const totalPayloadLen = 4 + mechBytes.length + 4 + msgBytes.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70); // 'p' — PasswordMessage (also used for SASL)
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

function buildSASLResponse(clientFinalMessage: string): Uint8Array {
	const msgBytes = encodeString(clientFinalMessage);
	const totalLen = 4 + msgBytes.length;
	const header = allocBuffer(5);
	header.setUint8(0, 0x70); // 'p'
	header.setInt32(1, totalLen);
	return concatBytes(new Uint8Array(header.buffer), msgBytes);
}

// ---- Read Utilities ----

function readInt32BE(buf: Uint8Array, offset: number): number {
	return new DataView(buf.buffer, buf.byteOffset).getInt32(offset);
}

function indexOfZero(buf: Uint8Array, from: number): number {
	for (let i = from; i < buf.length; i++) {
		if (buf[i] === 0) return i;
	}
	return -1;
}

function sliceToString(buf: Uint8Array, start: number, end: number): string {
	return new TextDecoder().decode(buf.subarray(start, end));
}

// ---- Auth Types ----
const AUTH_OK = 0;
const AUTH_CLEARTEXT = 3;
const AUTH_MD5 = 5;
const AUTH_SASL = 10;
const AUTH_SASL_CONTINUE = 11;
const AUTH_SASL_FINAL = 12;

// ---- Main Entry ----

export function createPgListener(
	databaseUrl: string,
	channels: string[],
	onNotify: NotifyHandler
): PgListenerHandle {
	const opts = parseDSN(databaseUrl);
	let listenSent = false;
	let closed = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let pending = new Uint8Array(0);

	// SCRAM-SHA-256 state (per connection)
	let scramClientNonce = "";
	let scramClientFirstBare = "";
	let scramServerFirstMessage = "";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function processMessages(socket: any) {
		while (pending.length >= 5) {
			const msgType = pending[0]!;
			const msgLen = readInt32BE(pending, 1);
			const totalLen = 1 + msgLen;

			if (pending.length < totalLen) break; // Incomplete packet, wait for next data chunk

			const body = pending.subarray(5, totalLen);

			switch (msgType) {
				case 0x52: {
					// 'R' — Authentication
					const authType = readInt32BE(body, 0);
					if (authType === AUTH_OK) {
						// Auth success — nothing to do, wait for ReadyForQuery
					} else if (authType === AUTH_MD5) {
						const salt = body.subarray(4, 8);
						socket.write(buildMD5AuthResponse(opts.user, opts.password, salt));
					} else if (authType === AUTH_CLEARTEXT) {
						socket.write(buildCleartextAuthResponse(opts.password));
					} else if (authType === AUTH_SASL) {
						// SASL mechanism list — pick SCRAM-SHA-256
						const mechList = sliceToString(body, 4, body.length);
						if (!mechList.includes("SCRAM-SHA-256")) {
							console.error("[pg-listen] Server does not support SCRAM-SHA-256");
							break;
						}
						// Generate client nonce and first message
						scramClientNonce = randomBytes(18).toString("base64");
						scramClientFirstBare = `n=,r=${scramClientNonce}`;
						const clientFirstMessage = `n,,${scramClientFirstBare}`;
						socket.write(buildSASLInitialResponse("SCRAM-SHA-256", clientFirstMessage));
					} else if (authType === AUTH_SASL_CONTINUE) {
						// Server's challenge
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
							console.error("[pg-listen] SCRAM: server nonce mismatch");
							break;
						}

						// Compute ClientProof
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

						const clientFinalMessage = `${clientFinalNoProof},p=${clientProof.toString("base64")}`;
						socket.write(buildSASLResponse(clientFinalMessage));
					} else if (authType === AUTH_SASL_FINAL) {
						// Server's final verification — we could verify the server signature here
						// but for simplicity, we just accept it and wait for AuthenticationOk
					} else {
						console.error(`[pg-listen] Unsupported auth type: ${authType}`);
					}
					break;
				}

				case 0x5a: {
					// 'Z' — ReadyForQuery
					if (!listenSent) {
						const sql = channels.map((ch) => `LISTEN ${ch}`).join("; ");
						socket.write(buildSimpleQuery(sql));
						listenSent = true;
						console.log(`[pg-listen] Connected and subscribed: ${channels.join(", ")}`);
					}
					break;
				}

				case 0x41: {
					// 'A' — NotificationResponse ★
					// pid(4) + channel(CString) + payload(CString)
					let pos = 4;
					const chEnd = indexOfZero(body, pos);
					if (chEnd < 0) break;
					const channel = sliceToString(body, pos, chEnd);
					pos = chEnd + 1;
					const plEnd = indexOfZero(body, pos);
					if (plEnd < 0) break;
					const payload = sliceToString(body, pos, plEnd);

					try {
						onNotify(channel, payload);
					} catch (err) {
						console.error(`[pg-listen] Notification callback error (channel=${channel}):`, err);
					}
					break;
				}

				case 0x45: {
					// 'E' — ErrorResponse
					const text = sliceToString(body, 0, body.length).replace(/\0/g, " | ");
					console.error(`[pg-listen] PostgreSQL error: ${text}`);
					break;
				}
				// Other messages ('S','K','T','C','D','N') are silently ignored
			}

			pending = pending.subarray(totalLen);
		}
	}

	function connect() {
		if (closed) return;
		listenSent = false;
		pending = new Uint8Array(0);
		scramClientNonce = "";
		scramClientFirstBare = "";
		scramServerFirstMessage = "";

		Bun.connect({
			hostname: opts.host,
			port: opts.port,
			socket: {
				open(socket: any) {
					socket.write(buildStartupMessage(opts.user, opts.database));
				},
				data(socket: any, rawData: any) {
					const chunk = new Uint8Array(rawData instanceof ArrayBuffer ? rawData : rawData.buffer ?? rawData);
					pending = concatBytes(pending, chunk);
					processMessages(socket);
				},
				error(_socket: any, err: any) {
					console.error("[pg-listen] Connection error:", err);
				},
				close() {
					if (closed) return;
					console.log("[pg-listen] Connection closed, reconnecting in 3s...");
					reconnectTimer = setTimeout(connect, 3000);
				}
			}
		}).catch((err) => {
			console.error("[pg-listen] Failed to connect:", err);
			if (!closed) {
				reconnectTimer = setTimeout(connect, 3000);
			}
		});
	}

	connect();

	return {
		close() {
			closed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
		}
	};
}
