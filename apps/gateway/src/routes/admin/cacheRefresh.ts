import { memoryCache } from '../../services/cache';
import { optionCache } from '../../services/optionCache';

export async function refreshAllCaches(): Promise<void> {
    await memoryCache.refresh();
    await optionCache.refresh();
}
