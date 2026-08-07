import { describe, expect, test } from 'bun:test';
import { isVisibleEnterpriseResource, VISIBLE_ENTERPRISE_RESOURCES } from './menu-policy';

describe('enterprise menu policy', () => {
	test('only exposes enterprise resources backed by the lightweight panel API', () => {
		expect(VISIBLE_ENTERPRISE_RESOURCES).toEqual(['customers', 'teams']);
		expect(isVisibleEnterpriseResource('users')).toBe(false);
		expect(isVisibleEnterpriseResource('rbac')).toBe(false);
	});
});
