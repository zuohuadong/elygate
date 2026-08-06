import { describe, expect, it } from 'bun:test';
import { configFormFromDocument, emptyConfigForm, mergeConfigForm } from './config-form';
import type { JsonRecord } from './api';

function sampleDocument(): JsonRecord {
	return {
		auth_config: {
			admin_password: { value: '<redacted>' },
			admin_username: { value: 'admini', type: 'plain_text' },
			is_enabled: true,
		},
		client_config: {
			drop_excess_requests: false,
			initial_pool_size: 5000,
			prometheus_labels: [],
			enable_logging: true,
			disable_content_logging: false,
			retain_content_in_object_storage: false,
			allow_per_request_content_storage_override: false,
			allow_per_request_raw_override: false,
			allow_direct_keys: false,
			disable_db_pings_in_health: false,
			log_retention_days: 365,
			enforce_auth_on_inference: false,
			dual_credential_conflict_behavior: 'prefer_idp',
			allowed_origins: ['*'],
			max_request_body_size_mb: 100,
			compat: {
				convert_text_to_chat: true,
				convert_chat_to_responses: true,
				should_drop_params: true,
				should_convert_params: false,
			},
			mcp_agent_depth: 10,
			mcp_tool_execution_timeout: 30,
			mcp_code_mode_binding_level: 'server',
			mcp_tool_sync_interval: 10,
			mcp_disable_auto_tool_inject: false,
			mcp_enable_temp_token_auth: false,
			async_job_result_ttl: 3600,
			hide_deleted_virtual_keys_in_filters: false,
			routing_chain_max_depth: 10,
			mcp_external_client_url: { value: '', type: 'plain_text' },
			mcp_server_auth_mode: 'headers',
			dump_errors_in_console_logs: false,
			some_future_field: { nested: true },
		},
		framework_config: {
			id: 0,
			pricing_url: 'https://getbifrost.ai/datasheet',
			pricing_sync_interval: 86400,
			model_parameters_url: 'https://getbifrost.ai/datasheet/model-parameters',
			mcp_library_url: 'https://getbifrost.ai/mcp-library',
			mcp_library_sync_interval: 86400,
			config_hash: 'abc123',
		},
		is_db_connected: true,
		restart_required: { required: false },
	};
}

describe('config-form', () => {
	it('从文档提取表单值', () => {
		const form = configFormFromDocument(sampleDocument());
		expect(form.authEnabled).toBe(true);
		expect(form.adminUsername).toBe('admini');
		expect(form.adminPassword).toBe('<redacted>');
		expect(form.initialPoolSize).toBe(5000);
		expect(form.enableLogging).toBe(true);
		expect(form.allowedOrigins).toBe('*');
		expect(form.dualCredentialConflictBehavior).toBe('prefer_idp');
		expect(form.mcpServerAuthMode).toBe('headers');
		expect(form.mcpCodeModeBindingLevel).toBe('server');
		expect(form.pricingUrl).toBe('https://getbifrost.ai/datasheet');
		expect(form.compatShouldDropParams).toBe(true);
	});

	it('空文档返回安全默认值', () => {
		const form = configFormFromDocument({});
		expect(form).toEqual(emptyConfigForm());
		expect(form.dualCredentialConflictBehavior).toBe('prefer_idp');
		expect(form.mcpServerAuthMode).toBe('headers');
	});

	it('合并时只覆盖表单字段并保留未知字段与状态位', () => {
		const base = sampleDocument();
		const form = configFormFromDocument(base);
		form.enableLogging = false;
		form.initialPoolSize = 8000;
		form.allowedOrigins = 'https://a.example, https://b.example';
		form.prometheusLabels = 'env, region';
		form.adminPassword = 'new-secret';
		form.dualCredentialConflictBehavior = 'prefer_vk';
		form.mcpServerAuthMode = 'both';

		const merged = mergeConfigForm(base, form);
		const client = merged.client_config as JsonRecord;
		expect(client.enable_logging).toBe(false);
		expect(client.initial_pool_size).toBe(8000);
		expect(client.allowed_origins).toEqual(['https://a.example', 'https://b.example']);
		expect(client.prometheus_labels).toEqual(['env', 'region']);
		expect(client.dual_credential_conflict_behavior).toBe('prefer_vk');
		expect(client.mcp_server_auth_mode).toBe('both');
		// 未由表单管理的字段原样保留
		expect(client.some_future_field).toEqual({ nested: true });
		expect(merged.is_db_connected).toBe(true);
		expect(merged.restart_required).toEqual({ required: false });
		const framework = merged.framework_config as JsonRecord;
		expect(framework.id).toBe(0);
		expect(framework.config_hash).toBe('abc123');
		// 密钥包装结构保留 type 等附加字段
		const auth = merged.auth_config as JsonRecord;
		expect(auth.is_enabled).toBe(true);
		expect(auth.admin_username).toEqual({ value: 'admini', type: 'plain_text' });
		expect(auth.admin_password).toEqual({ value: 'new-secret' });
		// 不修改原对象
		expect((base.client_config as JsonRecord).enable_logging).toBe(true);
	});

	it('合并空文档时创建缺失的配置分组', () => {
		const form = emptyConfigForm();
		form.authEnabled = true;
		form.adminUsername = 'admin';
		form.enableLogging = true;
		const merged = mergeConfigForm({}, form);
		expect((merged.auth_config as JsonRecord).is_enabled).toBe(true);
		expect((merged.auth_config as JsonRecord).admin_username).toEqual({ value: 'admin' });
		expect((merged.client_config as JsonRecord).enable_logging).toBe(true);
		expect(merged.framework_config).toBeDefined();
	});

	it('非法数字回退到原始值', () => {
		const base = sampleDocument();
		const form = configFormFromDocument(base);
		form.initialPoolSize = Number.NaN;
		form.logRetentionDays = Number.POSITIVE_INFINITY;
		const merged = mergeConfigForm(base, form);
		const client = merged.client_config as JsonRecord;
		expect(client.initial_pool_size).toBe(5000);
		expect(client.log_retention_days).toBe(365);
	});
});
