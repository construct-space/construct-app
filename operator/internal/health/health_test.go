package health

import (
	"fmt"
	"testing"
	"time"
)

func TestNewMonitor(t *testing.T) {
	m := NewMonitor()
	if m == nil {
		t.Fatal("NewMonitor returned nil")
	}
	if len(m.providers) != 0 {
		t.Fatal("new monitor should have no providers")
	}
}

func TestRecordSuccess(t *testing.T) {
	m := NewMonitor()
	m.RecordSuccess("anthropic", 150*time.Millisecond)

	ph := m.Check("anthropic")
	if ph == nil {
		t.Fatal("expected provider health after recording success")
	}
	if ph.Status != StatusHealthy {
		t.Fatalf("expected healthy, got %q", ph.Status)
	}
	if ph.SuccessCount != 1 {
		t.Fatalf("expected 1 success, got %d", ph.SuccessCount)
	}
	if ph.LastSuccess.IsZero() {
		t.Fatal("last success should be set")
	}
	if ph.AvgLatency() != 150*time.Millisecond {
		t.Fatalf("expected avg latency 150ms, got %v", ph.AvgLatency())
	}
}

func TestRecordError(t *testing.T) {
	m := NewMonitor()
	m.RecordError("anthropic", fmt.Errorf("API error 500"))

	ph := m.Check("anthropic")
	if ph == nil {
		t.Fatal("expected provider health")
	}
	if ph.ErrorCount != 1 {
		t.Fatalf("expected 1 error, got %d", ph.ErrorCount)
	}
	if ph.LastErrorMsg != "API error 500" {
		t.Fatalf("expected error msg, got %q", ph.LastErrorMsg)
	}
}

func TestCheckUnknownProvider(t *testing.T) {
	m := NewMonitor()
	ph := m.Check("nonexistent")
	if ph != nil {
		t.Fatal("expected nil for unknown provider")
	}
}

func TestStatusDegraded(t *testing.T) {
	m := NewMonitor()

	// Record enough errors to trigger degraded status.
	for i := 0; i < 3; i++ {
		m.RecordError("anthropic", fmt.Errorf("error %d", i))
	}

	ph := m.Check("anthropic")
	if ph.Status != StatusDegraded {
		t.Fatalf("expected degraded after 3 errors, got %q", ph.Status)
	}
}

func TestStatusUnhealthy(t *testing.T) {
	m := NewMonitor()

	for i := 0; i < 10; i++ {
		m.RecordError("anthropic", fmt.Errorf("error %d", i))
	}

	ph := m.Check("anthropic")
	if ph.Status != StatusUnhealthy {
		t.Fatalf("expected unhealthy after 10 errors, got %q", ph.Status)
	}
}

func TestSuccessResetsErrorCount(t *testing.T) {
	m := NewMonitor()

	// Build up some errors.
	for i := 0; i < 5; i++ {
		m.RecordError("anthropic", fmt.Errorf("error"))
	}
	ph := m.Check("anthropic")
	if ph.Status == StatusHealthy {
		t.Fatal("should not be healthy with 5 errors")
	}

	// A single success resets the consecutive error count.
	m.RecordSuccess("anthropic", 100*time.Millisecond)
	ph = m.Check("anthropic")
	if ph.Status != StatusHealthy {
		t.Fatalf("expected healthy after success, got %q", ph.Status)
	}
	if ph.ErrorCount != 0 {
		t.Fatalf("error count should be reset to 0, got %d", ph.ErrorCount)
	}
}

func TestAvgLatency(t *testing.T) {
	m := NewMonitor()

	m.RecordSuccess("anthropic", 100*time.Millisecond)
	m.RecordSuccess("anthropic", 200*time.Millisecond)
	m.RecordSuccess("anthropic", 300*time.Millisecond)

	ph := m.Check("anthropic")
	avg := ph.AvgLatency()
	if avg != 200*time.Millisecond {
		t.Fatalf("expected avg latency 200ms, got %v", avg)
	}
}

func TestAvgLatencyNoSuccess(t *testing.T) {
	ph := &ProviderHealth{SuccessCount: 0}
	if ph.AvgLatency() != 0 {
		t.Fatal("avg latency with no successes should be 0")
	}
}

func TestReportAllHealthy(t *testing.T) {
	m := NewMonitor()

	m.RecordSuccess("anthropic", 100*time.Millisecond)
	m.RecordSuccess("deepseek", 200*time.Millisecond)

	report := m.Report()
	if report.Status != StatusHealthy {
		t.Fatalf("expected overall healthy, got %q", report.Status)
	}
	if len(report.Providers) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(report.Providers))
	}
	if report.Uptime <= 0 {
		t.Fatal("uptime should be positive")
	}
}

func TestReportMixed(t *testing.T) {
	m := NewMonitor()

	m.RecordSuccess("anthropic", 100*time.Millisecond)

	// Make deepseek degraded.
	for i := 0; i < 5; i++ {
		m.RecordError("deepseek", fmt.Errorf("error"))
	}

	report := m.Report()
	// Has one healthy and one degraded → overall should not be unhealthy.
	// Since we have at least one healthy, overall is healthy? No — we have a degraded one.
	// The logic: if any is not healthy and we still have healthy ones, it's still healthy overall.
	// Actually per the code: hasHealthy=true, allUnhealthy=false → status stays healthy.
	if report.Status != StatusHealthy {
		t.Fatalf("expected overall healthy (at least one healthy), got %q", report.Status)
	}
}

func TestReportAllUnhealthy(t *testing.T) {
	m := NewMonitor()

	for i := 0; i < 10; i++ {
		m.RecordError("anthropic", fmt.Errorf("error"))
		m.RecordError("deepseek", fmt.Errorf("error"))
	}

	report := m.Report()
	if report.Status != StatusUnhealthy {
		t.Fatalf("expected overall unhealthy, got %q", report.Status)
	}
}

func TestReportNoProviders(t *testing.T) {
	m := NewMonitor()
	report := m.Report()
	if report.Status != StatusHealthy {
		t.Fatalf("empty system should be healthy, got %q", report.Status)
	}
}

func TestReportAllDegraded(t *testing.T) {
	m := NewMonitor()

	// Make both providers degraded (3-9 consecutive errors).
	for i := 0; i < 5; i++ {
		m.RecordError("anthropic", fmt.Errorf("error"))
		m.RecordError("deepseek", fmt.Errorf("error"))
	}

	report := m.Report()
	// All degraded, none healthy, not all unhealthy → degraded
	if report.Status != StatusDegraded {
		t.Fatalf("expected overall degraded, got %q", report.Status)
	}
}
