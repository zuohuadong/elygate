import { describe, expect, test } from "bun:test";
import { __pgListenInternals as internals } from "./index";

describe("pg-listen SQL helpers", () => {
	test("quotes LISTEN channel identifiers safely", () => {
		expect(internals.buildListenQuery(["auth_update"])).toBe('LISTEN "auth_update"');
		expect(internals.buildListenQuery(['weird"; NOTIFY hacked; --'])).toBe(
			'LISTEN "weird""; NOTIFY hacked; --"'
		);
	});

	test("rejects invalid identifiers", () => {
		expect(() => internals.buildListenQuery([""])).toThrow("identifier");
		expect(() => internals.buildListenQuery(["bad\0channel"])).toThrow("null bytes");
	});

	test("builds pg_notify calls with escaped literals", () => {
		expect(internals.buildNotifyQuery("auth_update", "token'1")).toBe(
			"SELECT pg_notify('auth_update', 'token''1')"
		);
		expect(internals.buildNotifyQuery("x'); SELECT 1; --", "payload")).toBe(
			"SELECT pg_notify('x''); SELECT 1; --', 'payload')"
		);
	});

	test("rejects oversized NOTIFY payloads", () => {
		expect(() => internals.buildNotifyQuery("events", "x".repeat(8000))).toThrow("8000 bytes");
	});
});

describe("pg-listen TLS options", () => {
	test("parses sslmode=require from DSN", () => {
		const parsed = internals.parseDSN("postgres://u:p@example.test:5433/app?sslmode=require");
		expect(parsed.host).toBe("example.test");
		expect(parsed.port).toBe(5433);
		expect(parsed.database).toBe("app");
		expect(parsed.tls?.allowPlainFallback).toBe(false);
		expect(typeof parsed.tls?.tls).toBe("object");
		expect((parsed.tls?.tls as Bun.TLSOptions).rejectUnauthorized).toBe(false);
	});

	test("lets explicit TLS options override DSN SSL settings", () => {
		const parsed = internals.parseDSN("postgres://u:p@example.test/app?sslmode=disable", {
			tls: { rejectUnauthorized: true, serverName: "db.internal" }
		});
		expect(parsed.tls?.allowPlainFallback).toBe(false);
		expect((parsed.tls?.tls as Bun.TLSOptions).rejectUnauthorized).toBe(true);
		expect((parsed.tls?.tls as Bun.TLSOptions).serverName).toBe("db.internal");
	});

	test("supports sslmode=prefer fallback", () => {
		const parsed = internals.parseDSN("postgres://u:p@example.test/app?sslmode=prefer");
		expect(parsed.tls?.allowPlainFallback).toBe(true);
	});
});
