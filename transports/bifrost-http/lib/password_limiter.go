package lib

import (
	"sync"
	"time"
)

// PasswordLimiter throttles password attempts per client key (usually the
// remote IP plus the normalized username). Begin reserves one attempt and
// returns a finish callback the caller must invoke when the attempt is done;
// when the limit is exceeded it returns allowed=false and a no-op finish.
type PasswordLimiter interface {
	Begin(key, username string) (finish func(bool), allowed bool)
}

type passwordLimiterEntry struct {
	attempts []time.Time
}

type inMemoryPasswordLimiter struct {
	mu         sync.Mutex
	limit      int
	window     time.Duration
	maxEntries int
	entries    map[string]*passwordLimiterEntry
	lastSweep  time.Time
}

// NewPasswordLimiter builds a rolling-window limiter: at most limit attempts are
// admitted per key within window.
func NewPasswordLimiter(limit int, window time.Duration) PasswordLimiter {
	return newPasswordLimiter(limit, window, 0)
}

// NewBoundedPasswordLimiter refuses new keys at capacity instead of evicting
// active budgets. Non-positive maxEntries defaults to 4096 tracked keys.
func NewBoundedPasswordLimiter(limit int, window time.Duration, maxEntries int) PasswordLimiter {
	if maxEntries <= 0 {
		maxEntries = 4096
	}
	return newPasswordLimiter(limit, window, maxEntries)
}

func newPasswordLimiter(limit int, window time.Duration, maxEntries int) *inMemoryPasswordLimiter {
	if limit <= 0 {
		limit = 5
	}
	if window <= 0 {
		window = 15 * time.Minute
	}
	return &inMemoryPasswordLimiter{
		limit:      limit,
		window:     window,
		maxEntries: maxEntries,
		entries:    map[string]*passwordLimiterEntry{},
	}
}

func (l *inMemoryPasswordLimiter) Begin(key, username string) (func(bool), bool) {
	if l == nil {
		return func(bool) {}, true
	}
	id := key + "\x00" + username

	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()

	l.sweepExpired(now)

	entry := l.entries[id]
	if entry == nil {
		if l.maxEntries > 0 && len(l.entries) >= l.maxEntries {
			return func(bool) {}, false
		}
		entry = &passwordLimiterEntry{}
		l.entries[id] = entry
	}
	cutoff := now.Add(-l.window)
	kept := entry.attempts[:0]
	for _, attempt := range entry.attempts {
		if attempt.After(cutoff) {
			kept = append(kept, attempt)
		}
	}
	entry.attempts = kept
	if len(entry.attempts) >= l.limit {
		return func(bool) {}, false
	}
	entry.attempts = append(entry.attempts, now)
	return func(bool) {}, true
}

func (l *inMemoryPasswordLimiter) sweepExpired(now time.Time) {
	interval := l.window
	// A saturated map must recover without waiting another full window, but
	// rotating denied keys must not trigger an O(capacity) walk per request.
	if l.maxEntries > 0 && len(l.entries) >= l.maxEntries && interval > time.Second {
		interval = time.Second
	}
	if now.Sub(l.lastSweep) < interval {
		return
	}
	for key, entry := range l.entries {
		if len(entry.attempts) == 0 || !entry.attempts[len(entry.attempts)-1].After(now.Add(-l.window)) {
			delete(l.entries, key)
		}
	}
	l.lastSweep = now
}
