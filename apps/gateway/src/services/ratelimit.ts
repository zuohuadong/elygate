/**
 * Simple In-memory Rate Limiter (Token Bucket)
 * Relies on Bun's single-process characteristic for an in-process firewall.
 * Intercepts high-frequency requests (e.g., balance spamming) without Redis overhead.
 */

// Store access timestamps mapped to user_id or token_id
const accessRecords = new Map<string, number[]>();

// Global limit configuration (configurable via DB in the future)
// Currently sets a ceiling of 300 requests per 60 seconds.
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 300;

/**
 * Check if the given identifier triggers rate limiting
 * @param identifier Unique ID (Token ID or User ID)
 * @returns true if limited (rejected)
 */
export function isRateLimited(identifier: string | number): boolean {
    const key = String(identifier);
    const now = Date.now();

    if (!accessRecords.has(key)) {
        accessRecords.set(key, [now]);
        return false;
    }

    const timestamps = accessRecords.get(key)!;

    // Filter out timestamps outside the sliding window
    const windowStart = now - WINDOW_MS;

    // Only keep records within the window for performance
    let validStartIndex = 0;
    while (validStartIndex < timestamps.length && timestamps[validStartIndex] < windowStart) {
        validStartIndex++;
    }

    // Evict expired records
    if (validStartIndex > 0) {
        timestamps.splice(0, validStartIndex);
    }

    if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        return true; // Limit triggered
    }

    // Record this request
    timestamps.push(now);
    return false;
}

/**
 * Periodically clean up stale records every 5 minutes to prevent memory leaks.
 */
setInterval(() => {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    for (const [key, timestamps] of accessRecords.entries()) {
        const lastTimestamp = timestamps[timestamps.length - 1];
        if (!lastTimestamp || lastTimestamp < windowStart) {
            accessRecords.delete(key);
        }
    }
}, 5 * 60 * 1000);
