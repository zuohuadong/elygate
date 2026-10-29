package lib

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBoundedPasswordLimiterBudgets(t *testing.T) {
	// Cases: empty, first through fifth, sixth, other source, other username.
	limiter := NewBoundedPasswordLimiter(5, 15*time.Minute, 2)
	for attempt := 0; attempt < 6; attempt++ {
		finish, allowed := limiter.Begin("source", "")
		require.Equal(t, attempt < 5, allowed)
		require.NotNil(t, finish)
		finish(attempt == 0)
	}
	finish, allowed := limiter.Begin("other-source", "")
	require.True(t, allowed)
	finish(false)
	_, allowed = limiter.Begin("source", "rotated")
	require.False(t, allowed, "new key cannot evict a live budget at capacity")
	_, allowed = limiter.Begin("source", "")
	require.False(t, allowed)
}

func TestBoundedPasswordLimiterCapacityAndExpiry(t *testing.T) {
	// Cases: full/live, denied rotation, partial budget, expired, empty bucket.
	limiter := newPasswordLimiter(5, 15*time.Minute, 2)
	for _, key := range []string{"first", "second"} {
		finish, allowed := limiter.Begin(key, "")
		require.True(t, allowed)
		finish(false)
	}
	sweptAt := limiter.lastSweep
	for attempt := 0; attempt < 64; attempt++ {
		_, allowed := limiter.Begin(fmt.Sprintf("rotated-%d", attempt), "")
		require.False(t, allowed)
		require.Len(t, limiter.entries, 2)
	}
	require.Equal(t, sweptAt, limiter.lastSweep, "denied traffic must not force a sweep per request")
	_, allowed := limiter.Begin("first", "")
	require.True(t, allowed, "existing budget remains usable at capacity")
	first := limiter.entries["first\x00"]
	require.Len(t, first.attempts, 2)
	for index := range first.attempts {
		first.attempts[index] = time.Now().Add(-limiter.window)
	}
	limiter.lastSweep = time.Now().Add(-2 * time.Second)
	_, allowed = limiter.Begin("replacement", "")
	require.True(t, allowed)
	require.NotContains(t, limiter.entries, "first\x00")
	require.Len(t, limiter.entries, 2)
	limiter.entries["replacement\x00"].attempts = nil
	limiter.lastSweep = time.Now().Add(-2 * time.Second)
	_, allowed = limiter.Begin("next", "")
	require.True(t, allowed)
	require.NotContains(t, limiter.entries, "replacement\x00")
	require.Len(t, limiter.entries, 2)
}

func TestBoundedPasswordLimiterRollingExpiry(t *testing.T) {
	limiter := newPasswordLimiter(5, 15*time.Minute, 1)
	for range 5 {
		limiter.Begin("source", "")
	}
	entry := limiter.entries["source\x00"]
	entry.attempts[0] = time.Now().Add(-limiter.window)
	_, allowed := limiter.Begin("source", "")
	require.True(t, allowed, "one expired attempt permits exactly one replacement")
	require.Len(t, entry.attempts, 5)
	_, allowed = limiter.Begin("source", "")
	require.False(t, allowed)
	require.LessOrEqual(t, cap(entry.attempts), 8)
}

func TestBoundedPasswordLimiterConcurrentReservations(t *testing.T) {
	for _, scenario := range []string{"same-source", "rotated-sources"} {
		t.Run(scenario, func(t *testing.T) {
			limiter := newPasswordLimiter(5, 15*time.Minute, 4)
			var admitted atomic.Int64
			var workers sync.WaitGroup
			start := make(chan struct{})
			for index := range 64 {
				workers.Go(func() {
					<-start
					key := "source"
					if scenario == "rotated-sources" {
						key = fmt.Sprintf("source-%d", index)
					}
					finish, allowed := limiter.Begin(key, "")
					if allowed {
						admitted.Add(1)
					}
					finish(false)
				})
			}
			close(start)
			workers.Wait()
			if scenario == "same-source" {
				require.EqualValues(t, 5, admitted.Load())
				require.Len(t, limiter.entries, 1)
			} else {
				require.EqualValues(t, 4, admitted.Load())
				require.Len(t, limiter.entries, 4)
			}
		})
	}
}

func TestPasswordLimiterConstructorDefaults(t *testing.T) {
	bounded := NewBoundedPasswordLimiter(0, 0, 0).(*inMemoryPasswordLimiter)
	require.Equal(t, 5, bounded.limit)
	require.Equal(t, 15*time.Minute, bounded.window)
	require.Equal(t, 4096, bounded.maxEntries)
	original := NewPasswordLimiter(0, 0).(*inMemoryPasswordLimiter)
	require.Zero(t, original.maxEntries, "existing employee constructor remains uncapped")
	for index := range 4097 {
		_, allowed := original.Begin(fmt.Sprintf("source-%d", index), "")
		require.True(t, allowed)
	}
	require.Len(t, original.entries, 4097)
	for range 5 {
		_, allowed := original.Begin("same-source", "first-user")
		require.True(t, allowed)
	}
	_, allowed := original.Begin("same-source", "first-user")
	require.False(t, allowed)
	_, allowed = original.Begin("same-source", "second-user")
	require.True(t, allowed, "existing username buckets remain independent")
}

func BenchmarkPasswordLimiter(b *testing.B) {
	for _, bounded := range []bool{false, true} {
		for _, path := range []string{"admitted", "denied", "capacity-denied"} {
			if !bounded && path == "capacity-denied" {
				continue
			}
			b.Run(fmt.Sprintf("bounded=%t/%s", bounded, path), func(b *testing.B) {
				limiter := newPasswordLimiter(5, 15*time.Minute, 0)
				if bounded {
					limiter.maxEntries = 1
				}
				for range 5 {
					limiter.Begin("source", "")
				}
				key := "source"
				if path == "capacity-denied" {
					key = "other"
				}
				b.ReportAllocs()
				for b.Loop() {
					// Reset fixture state only; include this trivial assignment in the sample.
					if path == "admitted" {
						limiter.entries["source\x00"].attempts = limiter.entries["source\x00"].attempts[:0]
					}
					limiter.Begin(key, "")
				}
			})
		}
	}
}

func BenchmarkBoundedPasswordLimiterSweep(b *testing.B) {
	limiter := newPasswordLimiter(5, 15*time.Minute, 4096)
	for source := range 4096 {
		limiter.Begin(fmt.Sprintf("source-%d", source), "")
	}
	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		// Force a scheduled scan of a full live map; no active budget may be evicted.
		limiter.lastSweep = time.Time{}
		if _, allowed := limiter.Begin("new-source", ""); allowed {
			b.Fatal("full live map admitted a new source")
		}
	}
}
