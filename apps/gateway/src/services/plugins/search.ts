import { log } from '../../services/logger';
import { getErrorMessage } from '../../utils/error';
import { optionCache } from '../optionCache';

/**
 * Web Search Plugin
 * Supports searching via Google (Serper.dev) or Brave Search.
 */
export class WebSearchPlugin {
    static async search(query: string): Promise<string> {
        const engine = optionCache.get('SEARCH_ENGINE', 'serper'); // serper, brave
        const apiKey = optionCache.get('SEARCH_API_KEY', '');
        
        if (!apiKey) return 'Search disabled: API key missing.';

        try {
            if (engine === 'serper') {
                return await this.searchSerper(query, apiKey);
            } else if (engine === 'brave') {
                return await this.searchBrave(query, apiKey);
            }
            return 'Unsupported search engine.';
        } catch (e: unknown) {
            log.error(`[SearchPlugin] Error: ${getErrorMessage(e)}`);
            return `Search failed: ${getErrorMessage(e)}`;
        }
    }

    private static async searchSerper(query: string, apiKey: string): Promise<string> {
        const res = await fetch(apiUrls.search.serper, {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn' })
        });
        const data = await res.json();
        const results = data.organic?.slice(0, 5).map((r: Record<string, any>) => `[${r.title}](${r.link}): ${r.snippet}`).join('\n\n') || 'No results found.';
        return `Web Search Results for "${query}":\n\n${results}`;
    }

    private static async searchBrave(query: string, apiKey: string): Promise<string> {
        const res = await fetch(`${apiUrls.search.brave}?q=${encodeURIComponent(query)}`, {
            headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' }
        });
        const data = await res.json();
        const results = data.web?.results?.slice(0, 5).map((r: Record<string, any>) => `[${r.title}](${r.url}): ${r.description}`).join('\n\n') || 'No results found.';
        return `Web Search Results for "${query}":\n\n${results}`;
    }
}
