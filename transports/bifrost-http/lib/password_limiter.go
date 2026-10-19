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
	mu        sync.Mutex
	limit     int
	window    time.Duration
	entries   map[string]*passwordLimiterEntry
	lastSweep time.Time
}

// NewPasswordLimiter builds a fixed-window limiter: at most limit attempts are
// admitted per key within window.
func NewPasswordLimiter(limit int, window time.Duration) PasswordLimiter {
	if limit <= 0 {
		limit = 5
	}
	if window <= 0 {
		window = 15 * time.Minute
	}
	return &inMemoryPasswordLimiter{
		limit:   limit,
		window:  window,
		entries: map[string]*passwordLimiterEntry{},
	}
}

func (l *inMemoryPasswordLimiter) Begin(key, username string) (func(bool), bool) {
	if l == nil {
		return func(bool) {}, true
	}
	id := key + "\x00" + username
	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	// Bound memory: drop expired buckets opportunistically.
	if now.Sub(l.lastSweep) > l.window {
		for k, entry := range l.entries {
			if len(entry.attempts) == 0 || now.Sub(entry.attempts[len(entry.attempts)-1]) > l.window {
				delete(l.entries, k)
			}
		}
		l.lastSweep = now
	}

	entry := l.entries[id]
	if entry == nil {
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
