import { describe, expect, test } from 'bun:test';
import {
	activePluginFeatures,
	buildCreatePluginPayload,
	buildPluginMutationPayload,
	buildPluginSequence,
	buildPluginSequenceUpdates,
	managedPluginFromRecord,
	movePluginSequence,
	pluginDraftFromRecord,
} from './plugin-management';

const plugin = managedPluginFromRecord({
	name: 'governance',
	actualName: 'governance',
	description: 'Enforces virtual-key access, budgets, rate limits, and routing policies.',
	descriptionZh: '执行虚拟密钥访问、预算、限流和路由治理策略。',
	enabled: true,
	config: { mode: 'strict', token: { value: '********', ref: '' } },
	isCustom: true,
	path: '/plugins/governance.so',
	placement: 'pre_builtin',
	order: 0,
	features: ['guardrails-config', 'guardrails-providers'],
	status: { name: 'governance', status: 'active', types: ['llm', 'mcp'], logs: ['ready'] },
});

describe('plugin management helpers', () => {
	test('hydrates runtime status and builds a complete update payload', () => {
		const draft = pluginDraftFromRecord(plugin);
		draft.order = 3;
		expect(buildPluginMutationPayload(draft)).toEqual({
			enabled: true,
			config: { mode: 'strict', token: { value: '********', ref: '' } },
			path: '/plugins/governance.so',
			placement: 'pre_builtin',
			order: 3,
		});
		expect(plugin.status.types).toEqual(['llm', 'mcp']);
		expect(plugin.features).toEqual(['guardrails-config', 'guardrails-providers']);
		expect(plugin.descriptionZh).toBe('执行虚拟密钥访问、预算、限流和路由治理策略。');
	});

	test('derives visible features only from enabled active plugins', () => {
		const active = managedPluginFromRecord({
			name: 'guardrails', enabled: true, features: ['guardrails-config', 'guardrails-config'],
			status: { name: 'guardrails', status: 'active' },
		});
		const disabled = managedPluginFromRecord({
			name: 'cluster', enabled: false, features: ['cluster'],
			status: { name: 'cluster', status: 'disabled' },
		});
		expect(activePluginFeatures([active, disabled])).toEqual(['guardrails-config']);
	});

	test('creates built-in plugins without a native path', () => {
		expect(buildCreatePluginPayload({
			name: 'semantic_cache', kind: 'builtin', path: '/ignored.so', enabled: true,
			configJson: '{"ttl":60}', placement: 'post_builtin', order: 0,
		})).toEqual({
			name: 'semantic_cache', enabled: true, config: { ttl: 60 },
			path: undefined, placement: 'post_builtin', order: 0,
		});
	});

	test('rejects unsafe custom paths and non-object configuration', () => {
		expect(() => buildCreatePluginPayload({
			name: 'custom', kind: 'custom', path: 'plugin.so', enabled: true,
			configJson: '{}', placement: 'post_builtin', order: 0,
		})).toThrow('path-invalid');
		expect(() => buildCreatePluginPayload({
			name: 'custom', kind: 'custom', path: '/plugin.so', enabled: true,
			configJson: '[]', placement: 'post_builtin', order: 0,
		})).toThrow('config-object');
	});

	test('moves custom plugins across the built-in boundary and preserves full updates', () => {
		const post = managedPluginFromRecord({
			name: 'audit', enabled: false, config: { sink: 'db' }, isCustom: true,
			path: 'https://plugins.example.com/audit.so', placement: 'post_builtin', order: 0,
		});
		const sequence = buildPluginSequence([post, plugin]);
		expect(sequence.map((item) => item.id)).toEqual(['governance', '__builtin__', 'audit']);
		const moved = movePluginSequence(sequence, 'audit', -1);
		expect(moved.map((item) => item.id)).toEqual(['governance', 'audit', '__builtin__']);
		expect(buildPluginSequenceUpdates(moved)).toEqual([
			{
				name: 'audit',
				payload: {
					enabled: false,
					config: { sink: 'db' },
					path: 'https://plugins.example.com/audit.so',
					placement: 'pre_builtin',
					order: 1,
				},
			},
		]);
	});
});
