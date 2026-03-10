type Language = 'zh' | 'en';

const messages = {
    zh: {
        'Username and password are required': '用户名和密码不能为空',
        'Username already exists': '用户名已存在',
        'Registration successful': '注册成功',
        'Invalid username or password': '用户名或密码错误',
        'Account is disabled': '账户已被禁用',
        'Account has no access': '账户无访问权限',
        'Internal server error': '服务器内部错误',
        'Cannot delete your own account': '不能删除自己的账户',
        'Cannot delete the last admin account': '不能删除最后一个管理员账户',
        'Channel not found': '渠道未找到',
        'Token not found': '令牌未找到',
        'User not found': '用户未找到',
        'Operation successful': '操作成功',
        'Operation failed': '操作失败',
        'Permission denied': '权限不足',
        'Invalid request': '无效的请求',
        'Data validation failed': '数据验证失败',
    },
    en: {
        'Username and password are required': 'Username and password are required',
        'Username already exists': 'Username already exists',
        'Registration successful': 'Registration successful',
        'Invalid username or password': 'Invalid username or password',
        'Account is disabled': 'Account is disabled',
        'Account has no access': 'Account has no access',
        'Internal server error': 'Internal server error',
        'Cannot delete your own account': 'Cannot delete your own account',
        'Cannot delete the last admin account': 'Cannot delete the last admin account',
        'Channel not found': 'Channel not found',
        'Token not found': 'Token not found',
        'User not found': 'User not found',
        'Operation successful': 'Operation successful',
        'Operation failed': 'Operation failed',
        'Permission denied': 'Permission denied',
        'Invalid request': 'Invalid request',
        'Data validation failed': 'Data validation failed',
    }
};

export function t(key: string, lang: Language = 'zh'): string {
    return messages[lang]?.[key] || messages['en']?.[key] || key;
}

export function getLangFromHeader(acceptLanguage?: string | null | string[]): Language {
    if (!acceptLanguage) return 'zh';
    const langStr = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
    if (typeof langStr === 'string' && langStr.includes('zh')) return 'zh';
    return 'en';
}

export function getLangFromQuery(query?: any): Language {
    if (!query) return 'zh';
    const lang = query.lang || query.language;
    if (lang === 'en' || lang === 'zh') return lang;
    return 'zh';
}
