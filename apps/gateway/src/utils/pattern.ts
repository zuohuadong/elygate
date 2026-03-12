/**
 * Wildcard pattern matcher for model names.
 * Supports trailing '*' for prefix matching.
 *
 * @example matchPattern('gpt-4o', ['gpt-4*']) => true
 * @example matchPattern('claude-3', ['gpt-4*', 'claude-3']) => true
 */
export function matchPattern(modelName: string, patternList: string[]): boolean {
    if (!patternList || patternList.length === 0) return false;
    return patternList.some((pattern: string) => {
        if (pattern.endsWith('*')) return modelName.startsWith(pattern.slice(0, -1));
        return modelName === pattern;
    });
}
