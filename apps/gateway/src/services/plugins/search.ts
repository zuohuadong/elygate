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
        } catch (e: any) {
            console.error(`[SearchPlugin] Error: ${e.message}`);
            return `Search failed: ${e.message}`;
        }
    }

    private static async searchSerper(query: string, apiKey: string): Promise<string> {
        const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn' })
        });
        const data = await res.json();
        const results = data.organic?.slice(0, 5).map((r: any) => `[${r.title}](${r.link}): ${r.snippet}`).join('\n\n') || 'No results found.';
        return `Web Search Results for "${query}":\n\n${results}`;
    }

    private static async searchBrave(query: string, apiKey: string): Promise<string> {
        const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
            headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' }
        });
        const data = await res.json();
        const results = data.web?.results?.slice(0, 5).map((r: any) => `[${r.title}](${r.url}): ${r.description}`).join('\n\n') || 'No results found.';
        return `Web Search Results for "${query}":\n\n${results}`;
    }
}
