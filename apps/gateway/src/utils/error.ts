/**
 * Extract error message from an unknown caught value.
 * Replaces the `catch (e: unknown) { e.message }` anti-pattern.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return String(error);
}
