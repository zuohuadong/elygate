/**
 * Recursively remove null fields from an object or array.
 * Used to clean up API responses.
 */
export function removeNullFields(obj: unknown): unknown {
    if (Array.isArray(obj)) {
        return obj.map(removeNullFields).filter(v => v !== null);
    }
    if (obj !== null && typeof obj === 'object') {
        const cleaned: Record<string, any> = {};
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (value !== null) {
                cleaned[key] = removeNullFields(value);
            }
        }
        return cleaned;
    }
    return obj;
}
