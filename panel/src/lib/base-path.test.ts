import { describe, expect, test } from 'bun:test';
import { normalizeBasePath, stripBasePath, withBasePath } from './base-path';

describe('gateway base path', () => {
	test('normalizes injected base paths and rejects non-paths', () => {
		expect(normalizeBasePath('/bifrost')).toBe('/bifrost');
		expect(normalizeBasePath('bifrost/')).toBe('/bifrost');
		expect(normalizeBasePath('///')).toBe('');
		expect(normalizeBasePath('/')).toBe('');
		expect(normalizeBasePath(undefined)).toBe('');
	});

	test('prefixes only gateway-relative paths and never doubles the prefix', () => {
		expect(withBasePath('/api/logs', '/bifrost')).toBe('/bifrost/api/logs');
		expect(withBasePath('/bifrost/api/logs', '/bifrost')).toBe('/bifrost/api/logs');
		expect(withBasePath('/', '/bifrost')).toBe('/bifrost/');
		expect(withBasePath('/api/logs', '')).toBe('/api/logs');
		expect(withBasePath('https://example.com/api', '/bifrost')).toBe('https://example.com/api');
		expect(withBasePath('//cdn.example.com/a.js', '/bifrost')).toBe('//cdn.example.com/a.js');
	});

	test('strips the prefix for public-route and deep-link resolution', () => {
		expect(stripBasePath('/bifrost/employee', '/bifrost')).toBe('/employee');
		expect(stripBasePath('/bifrost', '/bifrost')).toBe('/');
		expect(stripBasePath('/bifrost/', '/bifrost')).toBe('/');
		expect(stripBasePath('/employee', '/bifrost')).toBe('/employee');
		expect(stripBasePath('/bifrostish/employee', '/bifrost')).toBe('/bifrostish/employee');
	});
});
