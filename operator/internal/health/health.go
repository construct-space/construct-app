// Package health tracks provider health and system status.
package health

import (
	"sync"
	"time"
)

// Status represents the health state of a provider.
type Status string

const (
	StatusHealthy   Status = "healthy"
	StatusDegraded  Status = "degraded"  // some errors but still responding
	StatusUnhealthy Status = "unhealthy" // too many errors or not responding
)

// ProviderHealth holds health metrics for a single provider.
type ProviderHealth struct {
	ProviderID     string    `json:"provider_id"`
	Status         Status    `json:"status"`
	LastSuccess    time.Time `json:"last_success,omitempty"`
	LastError      time.Time `json:"last_error,omitempty"`
	LastErrorMsg   string    `json:"last_error_msg,omitempty"`
	ErrorCount     int64     `json:"error_count"`
	SuccessCount   int64     `json:"success_count"`
	TotalLatencyMs int64     `json:"total_latency_ms"` // cumulative, for computing average
}

// AvgLatency returns the average latency across all successful calls.
func (ph *ProviderHealth) AvgLatency() time.Duration {
	if ph.SuccessCount == 0 {
		return 0
	}
	avg := ph.TotalLatencyMs / ph.SuccessCount
	return time.Duration(avg) * time.Millisecond
}

// SystemReport is the overall system health snapshot.
type SystemReport struct {
	Status    Status                     `json:"status"`
	Uptime    time.Duration              `json:"uptime"`
	Providers map[string]*ProviderHealth `json:"providers"`
}

// Monitor tracks health metrics for multiple providers.
type Monitor struct {
	mu        sync.RWMutex
	providers map[string]*ProviderHealth
	startTime time.Time

	// Thresholds for status determination.
	degradedErrorThreshold  int64         // consecutive errors before "degraded"
	unhealthyErrorThreshold int64         // consecutive errors before "unhealthy"
	staleThreshold          time.Duration // time since last success before "unhealthy"
}

// NewMonitor creates a health Monitor with sensible defaults.
func NewMonitor() *Monitor {
	return &Monitor{
		providers:               make(map[string]*ProviderHealth),
		startTime:               time.Now(),
		degradedErrorThreshold:  3,
		unhealthyErrorThreshold: 10,
		staleThreshold:          5 * time.Minute,
	}
}

// RecordSuccess records a successful provider call.
func (m *Monitor) RecordSuccess(providerID string, latency time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ph := m.getOrCreate(providerID)
	ph.SuccessCount++
	ph.ErrorCount = 0 // reset consecutive error count
	ph.LastSuccess = time.Now()
	ph.TotalLatencyMs += latency.Milliseconds()
	ph.Status = m.computeStatus(ph)
}

// RecordError records a failed provider call.
func (m *Monitor) RecordError(providerID string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ph := m.getOrCreate(providerID)
	ph.ErrorCount++
	ph.LastError = time.Now()
	if err != nil {
		ph.LastErrorMsg = err.Error()
	}
	ph.Status = m.computeStatus(ph)
}

// Check returns the health status for a specific provider.
// Returns nil if the provider has never been seen.
func (m *Monitor) Check(providerID string) *ProviderHealth {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ph, ok := m.providers[providerID]
	if !ok {
		return nil
	}

	// Return a copy to avoid races.
	cp := *ph
	// Recompute status with current time (staleness may have changed).
	cp.Status = m.computeStatus(&cp)
	return &cp
}

// Report returns a full system health report.
func (m *Monitor) Report() SystemReport {
	m.mu.RLock()
	defer m.mu.RUnlock()

	report := SystemReport{
		Status:    StatusHealthy,
		Uptime:    time.Since(m.startTime),
		Providers: make(map[string]*ProviderHealth, len(m.providers)),
	}

	hasHealthy := false
	allUnhealthy := true

	for id, ph := range m.providers {
		cp := *ph
		cp.Status = m.computeStatus(&cp)
		report.Providers[id] = &cp

		switch cp.Status {
		case StatusHealthy:
			hasHealthy = true
			allUnhealthy = false
		case StatusDegraded:
			allUnhealthy = false
		}
	}

	// Overall status:
	// - all unhealthy → unhealthy
	// - some unhealthy or degraded → degraded
	// - all healthy (or no providers) → healthy
	if len(m.providers) > 0 {
		if allUnhealthy {
			report.Status = StatusUnhealthy
		} else if !hasHealthy {
			report.Status = StatusDegraded
		}
	}

	return report
}

// getOrCreate returns the ProviderHealth for the given ID, creating it if needed.
// Must be called with m.mu held for writing.
func (m *Monitor) getOrCreate(providerID string) *ProviderHealth {
	ph, ok := m.providers[providerID]
	if !ok {
		ph = &ProviderHealth{
			ProviderID: providerID,
			Status:     StatusHealthy,
		}
		m.providers[providerID] = ph
	}
	return ph
}

// computeStatus determines provider status from its metrics.
// Must be called with m.mu held (read or write).
func (m *Monitor) computeStatus(ph *ProviderHealth) Status {
	// Check consecutive error count.
	if ph.ErrorCount >= m.unhealthyErrorThreshold {
		return StatusUnhealthy
	}
	if ph.ErrorCount >= m.degradedErrorThreshold {
		return StatusDegraded
	}

	// Check staleness: if we've had success before but not recently, degrade.
	if !ph.LastSuccess.IsZero() && time.Since(ph.LastSuccess) > m.staleThreshold && ph.ErrorCount > 0 {
		return StatusDegraded
	}

	return StatusHealthy
}
