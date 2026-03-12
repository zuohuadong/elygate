type Language = 'en' | 'zh';

const errorMessages: Record<string, Record<Language, string>> = {
    'Insufficient user quota': {
        en: 'Insufficient user quota',
        zh: '用户额度不足'
    },
    'Insufficient token quota': {
        en: 'Insufficient token quota',
        zh: 'Token 额度不足'
    },
    'API key has expired': {
        en: 'API key has expired',
        zh: 'API 密钥已过期'
    },
    'Too Many Requests': {
        en: 'Too Many Requests',
        zh: '请求过于频繁'
    },
    'Invalid API key': {
        en: 'Invalid API key',
        zh: '无效的 API 密钥'
    },
    'Model not available': {
        en: 'Model not available',
        zh: '模型不可用'
    },
    'All providers/models failed': {
        en: 'All providers/models failed',
        zh: '所有渠道/模型均失败'
    },
    'Request timeout': {
        en: 'Request timeout',
        zh: '请求超时'
    },
    'Rate limit exceeded': {
        en: 'Rate limit exceeded',
        zh: '速率限制超出'
    }
};

function detectLanguage(acceptLanguage?: string): Language {
    if (!acceptLanguage) return 'en';
    const lang = acceptLanguage.toLowerCase();
    if (lang.includes('zh') || lang.includes('cn')) return 'zh';
    return 'en';
}

export function translateError(error: string, acceptLanguage?: string): string {
    const lang = detectLanguage(acceptLanguage);
    const translations = errorMessages[error];
    if (!translations) return error;
    return translations[lang];
}

export function translateErrorBilingual(error: string): string {
    const translations = errorMessages[error];
    if (!translations) return error;
    return `${translations.en} / ${translations.zh}`;
}

export function translateErrorWithLang(error: string, lang: Language): string {
    const translations = errorMessages[error];
    if (!translations) return error;
    return translations[lang];
}

export { type Language };
