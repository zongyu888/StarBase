package auth

import (
	"sync"
	"time"
)

type limitEntry struct {
	count int
	reset time.Time
}

type Limiter struct {
	mu      sync.Mutex
	entries map[string]limitEntry
}

func NewLimiter() *Limiter {
	return &Limiter{entries: make(map[string]limitEntry)}
}

// Allow 是进程内固定窗口限流；单实例部署足够，Redis 不可用时也不会失效。
func (l *Limiter) Allow(key string, limit int, window time.Duration) bool {
	if limit <= 0 || window <= 0 {
		return true
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) > 20_000 {
		for itemKey, entry := range l.entries {
			if entry.reset.Before(now) {
				delete(l.entries, itemKey)
			}
		}
		if len(l.entries) > 20_000 {
			l.entries = make(map[string]limitEntry)
		}
	}
	entry, ok := l.entries[key]
	if !ok || entry.reset.Before(now) {
		l.entries[key] = limitEntry{count: 1, reset: now.Add(window)}
		return true
	}
	if entry.count >= limit {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}

type failureEntry struct {
	count       int
	first       time.Time
	lockedUntil time.Time
}

type FailureTracker struct {
	mu      sync.Mutex
	entries map[string]failureEntry
}

func NewFailureTracker() *FailureTracker {
	return &FailureTracker{entries: make(map[string]failureEntry)}
}

func (f *FailureTracker) Locked(key string) (time.Duration, bool) {
	now := time.Now()
	f.mu.Lock()
	defer f.mu.Unlock()
	entry, ok := f.entries[key]
	if !ok {
		return 0, false
	}
	if entry.lockedUntil.After(now) {
		return time.Until(entry.lockedUntil), true
	}
	if entry.lockedUntil.IsZero() && now.Sub(entry.first) > 10*time.Minute {
		delete(f.entries, key)
	}
	return 0, false
}

func (f *FailureTracker) Record(key string, max int, window, lock time.Duration) time.Duration {
	now := time.Now()
	f.mu.Lock()
	defer f.mu.Unlock()
	entry := f.entries[key]
	if entry.first.IsZero() || now.Sub(entry.first) > window || entry.lockedUntil.Before(now) {
		entry = failureEntry{first: now}
	}
	entry.count++
	if entry.count >= max {
		entry.lockedUntil = now.Add(lock)
		entry.count = 0
		f.entries[key] = entry
		return lock
	}
	f.entries[key] = entry
	return 0
}

func (f *FailureTracker) Clear(key string) {
	f.mu.Lock()
	delete(f.entries, key)
	f.mu.Unlock()
}
