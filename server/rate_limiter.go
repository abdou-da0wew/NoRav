package main

import (
	"sync"
	"time"
)

type tokenBucket struct {
	tokens float64
	last   time.Time
}

type loginRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]tokenBucket
}

func newLoginLimiter() *loginRateLimiter {
	return &loginRateLimiter{buckets: make(map[string]tokenBucket)}
}

func (l *loginRateLimiter) allow(clientIP string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.buckets) > 4096 {
		for ip, bucket := range l.buckets {
			if now.Sub(bucket.last) > 20*time.Minute {
				delete(l.buckets, ip)
			}
		}
	}
	bucket, exists := l.buckets[clientIP]
	if !exists {
		bucket = tokenBucket{tokens: 6, last: now}
	}
	bucket.tokens += now.Sub(bucket.last).Seconds() / 10
	if bucket.tokens > 6 {
		bucket.tokens = 6
	}
	bucket.last = now
	if bucket.tokens < 1 {
		l.buckets[clientIP] = bucket
		return false
	}
	bucket.tokens--
	l.buckets[clientIP] = bucket
	return true
}

type ipConcurrencyLimiter struct {
	mu     sync.Mutex
	limit  int
	active map[string]int
}

func newIPConcurrencyLimiter(limit int) *ipConcurrencyLimiter {
	return &ipConcurrencyLimiter{limit: limit, active: make(map[string]int)}
}

func (l *ipConcurrencyLimiter) acquire(clientIP string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.active[clientIP] >= l.limit {
		return false
	}
	l.active[clientIP]++
	return true
}

func (l *ipConcurrencyLimiter) release(clientIP string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.active[clientIP] <= 1 {
		delete(l.active, clientIP)
		return
	}
	l.active[clientIP]--
}
