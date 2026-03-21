import { browser, dev } from '$app/environment';

/**
 * Console Sanitization Service
 * Wraps global console methods to prevent sensitive data leaks (admin tokens, session keys)
 * from being printed to the browser developer console in production.
 */

const SENSITIVE_KEYS = [
    'admin_token', 'admin_role', 'admin_username', 'admin_user_id', 
    'elygate_session', 'password', 'sk-', 'token', 'key', 'secret',
    'session', 'cookie', 'auth_session'
];

/**
 * Check if the content contains sensitive information.
 */
function isSensitive(data: unknown): boolean {
    if (!data) return false;

    // Convert to string for broad checking
    const str = typeof data === 'string' ? data : JSON.stringify(data);

    // Check for sensitive keys or value patterns
    for (const key of SENSITIVE_KEYS) {
        if (str.toLowerCase().includes(key.toLowerCase())) {
            return true;
        }
    }

    return false;
}

/**
 * Sanitize an object by redacting sensitive keys.
 */
function sanitize(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return isSensitive(obj) ? '[REDACTED]' : obj;

    if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item));
    }

    const sanitized: Record<string, unknown> = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof obj[key] === 'object') {
                sanitized[key] = sanitize(obj[key]);
            } else if (isSensitive(obj[key])) {
                // If the value itself looks sensitive (e.g. contains "sk-")
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = obj[key];
            }
        }
    }
    return sanitized;
}

/**
 * Initialize the global logger wrapper.
 */
export function initLogger() {
    if (!browser) return;

    // Save native console methods
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    const wrap = (original: Function, level: string) => {
        return (...args: unknown[]) => {
            // In dev mode, we allow logs but might still want to warn about sensitive data
            // In production, we sanitize everything or suppress if non-essential

            const sanitizedArgs = args.map(arg => sanitize(arg));

            // Log level logic
            if (level === 'error' || level === 'warn') {
                original.apply(console, sanitizedArgs);
            } else if (dev) {
                // In dev, show all logs but sanitized
                original.apply(console, sanitizedArgs);
            } else {
                // In production, we might want to suppress simple logs entirely 
                // but for now we just sanitize them to avoid breaking apps that rely on them.
                original.apply(console, sanitizedArgs);
            }
        };
    };

    // Override global console methods
    console.log = wrap(originalLog, 'log');
    console.info = wrap(originalInfo, 'info');
    console.warn = wrap(originalWarn, 'warn');
    console.error = wrap(originalError, 'error');

    if (dev) {
        originalLog('%c[Logger] Privacy protection active (Sanitizing sensitive keys)', 'color: #6366f1; font-weight: bold;');
    }
}
