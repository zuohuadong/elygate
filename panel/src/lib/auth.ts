import type { AuthActionResult, AuthProvider, CheckResult, Identity } from '@svadmin/core';
import { getSessionStatus, requestJson } from './api';
import type { ElygateLocale } from './i18n';

const authCopy = {
	'zh-CN': {
		loginRequired: '请输入用户名和密码',
		loginFailed: '登录失败',
		sessionExpired: '登录已过期，请重新登录。',
		authDisabled: '管理员认证尚未启用。请先在 Bifrost 部署配置中启用 auth_config。',
		sessionUnknown: '无法确认登录状态。',
		adminName: 'Elygate 管理员',
	},
	en: {
		loginRequired: 'Enter a username and password',
		loginFailed: 'Sign-in failed',
		sessionExpired: 'Your session has expired. Please sign in again.',
		authDisabled: 'Administrator authentication is disabled. Enable auth_config in the Bifrost deployment first.',
		sessionUnknown: 'Unable to confirm the sign-in state.',
		adminName: 'Elygate administrator',
	},
} as const;

function authLabel(locale: ElygateLocale, key: keyof typeof authCopy.en): string {
	return authCopy[locale][key];
}

function failed(message: string): AuthActionResult {
	return { success: false, error: { message } };
}

export function createBifrostAuthProvider(
	getLocale: () => ElygateLocale,
	onAuthenticated: () => Promise<void>,
): AuthProvider {
	return {
		async login(params): Promise<AuthActionResult> {
			const username = typeof params.username === 'string' ? params.username : '';
			const password = typeof params.password === 'string' ? params.password : '';
			if (!username || !password) return failed(authLabel(getLocale(), 'loginRequired'));

			try {
				await requestJson('/api/session/login', {
					method: 'POST',
					body: JSON.stringify({ username, password }),
				});
				await onAuthenticated();
				return { success: true, redirectTo: '/' };
			} catch (error) {
				return failed(error instanceof Error ? error.message : authLabel(getLocale(), 'loginFailed'));
			}
		},

		async logout(): Promise<AuthActionResult> {
			try {
				await requestJson('/api/session/logout', { method: 'POST' });
			} catch {
				// 即使服务端会话已过期，也应让前端回到登录页。
			}
			return { success: true, redirectTo: '/login' };
		},

		async check(): Promise<CheckResult> {
			try {
				const status = await getSessionStatus();
				if (status.is_auth_enabled && status.has_valid_token) return { authenticated: true };
				return {
					authenticated: false,
					redirectTo: '/login',
					error: {
						message: status.is_auth_enabled
							? authLabel(getLocale(), 'sessionExpired')
							: authLabel(getLocale(), 'authDisabled'),
					},
				};
			} catch (error) {
				return {
					authenticated: false,
					redirectTo: '/login',
					error: { message: error instanceof Error ? error.message : authLabel(getLocale(), 'sessionUnknown') },
				};
			}
		},

		async getIdentity(): Promise<Identity | null> {
			const status = await getSessionStatus();
			if (!status.is_auth_enabled || !status.has_valid_token) return null;
			return { id: 'bifrost-admin', name: authLabel(getLocale(), 'adminName') };
		},
	};
}
