package main

import (
	"sort"
	"strconv"
	"sync"
	"time"
)

type ipStats struct {
	IP       string    `json:"ip"`
	Requests uint64    `json:"requests"`
	Errors   uint64    `json:"errors"`
	BytesIn  uint64    `json:"bytesIn"`
	BytesOut uint64    `json:"bytesOut"`
	LastSeen time.Time `json:"lastSeen"`
}

type requestEvent struct {
	Time       time.Time `json:"time"`
	RequestID  string    `json:"requestId"`
	TraceID    string    `json:"traceId"`
	ClientIP   string    `json:"clientIp"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	Host       string    `json:"host,omitempty"`
	Status     int       `json:"status"`
	DurationMS float64   `json:"durationMs"`
	BytesIn    int64     `json:"bytesIn"`
	BytesOut   int64     `json:"bytesOut"`
}

type observability struct {
	mu          sync.RWMutex
	started     time.Time
	requests    uint64
	errors      uint64
	bytesIn     uint64
	bytesOut    uint64
	totalNanos  uint64
	methods     map[string]uint64
	statuses    map[int]uint64
	hosts       map[string]uint64
	ips         map[string]*ipStats
	events      []requestEvent
	eventCursor int
}

func newObservability() observability {
	return observability{
		started:  time.Now(),
		methods:  make(map[string]uint64),
		statuses: make(map[int]uint64),
		hosts:    make(map[string]uint64),
		ips:      make(map[string]*ipStats),
		events:   make([]requestEvent, 200),
	}
}

func (o *observability) record(event requestEvent, duration time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.requests++
	if event.Status >= 400 {
		o.errors++
	}
	o.bytesIn += uint64(max(event.BytesIn, 0))
	o.bytesOut += uint64(max(event.BytesOut, 0))
	o.totalNanos += uint64(max(duration.Nanoseconds(), 0))
	o.methods[event.Method]++
	o.statuses[event.Status]++
	if event.Host != "" {
		o.hosts[event.Host]++
	}
	ip := o.ips[event.ClientIP]
	if ip == nil {
		if len(o.ips) >= 4096 {
			event.ClientIP = "_overflow"
			ip = o.ips[event.ClientIP]
		}
		if ip == nil {
			ip = &ipStats{IP: event.ClientIP}
			o.ips[event.ClientIP] = ip
		}
	}
	ip.Requests++
	if event.Status >= 400 {
		ip.Errors++
	}
	ip.BytesIn += uint64(max(event.BytesIn, 0))
	ip.BytesOut += uint64(max(event.BytesOut, 0))
	ip.LastSeen = event.Time
	o.events[o.eventCursor] = event
	o.eventCursor = (o.eventCursor + 1) % len(o.events)
}

func (o *observability) snapshot() map[string]any {
	o.mu.RLock()
	defer o.mu.RUnlock()
	ips := make([]ipStats, 0, len(o.ips))
	for _, entry := range o.ips {
		ips = append(ips, *entry)
	}
	sort.Slice(ips, func(i, j int) bool { return ips[i].Requests > ips[j].Requests })
	if len(ips) > 20 {
		ips = ips[:20]
	}
	hosts := make([]map[string]any, 0, len(o.hosts))
	for host, requests := range o.hosts {
		hosts = append(hosts, map[string]any{"host": host, "requests": requests})
	}
	sort.Slice(hosts, func(i, j int) bool { return hosts[i]["requests"].(uint64) > hosts[j]["requests"].(uint64) })
	if len(hosts) > 20 {
		hosts = hosts[:20]
	}
	methods := make(map[string]uint64, len(o.methods))
	for key, value := range o.methods {
		methods[key] = value
	}
	statuses := make(map[string]uint64, len(o.statuses))
	for key, value := range o.statuses {
		statuses[strconv.Itoa(key)] = value
	}
	events := make([]requestEvent, 0, len(o.events))
	for i := 0; i < len(o.events); i++ {
		index := (o.eventCursor + i) % len(o.events)
		if o.events[index].RequestID != "" {
			events = append(events, o.events[index])
		}
	}
	for left, right := 0, len(events)-1; left < right; left, right = left+1, right-1 {
		events[left], events[right] = events[right], events[left]
	}
	average := float64(0)
	if o.requests > 0 {
		average = float64(o.totalNanos) / float64(o.requests) / 1e6
	}
	return map[string]any{
		"uptimeSeconds": time.Since(o.started).Seconds(),
		"requests":      o.requests, "errors": o.errors,
		"bytesIn": o.bytesIn, "bytesOut": o.bytesOut,
		"averageLatencyMs": average,
		"methods":          methods, "statuses": statuses,
		"topHosts": hosts, "topIPs": ips,
		"recentRequests": events,
	}
}
