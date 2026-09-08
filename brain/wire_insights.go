// insights.overview — aggregates the telemetry JSONL files into the
// shape InsightsSettings.vue expects. One pass over the last N days of
// files; everything is grouped in memory and returned as a single
// response. Heavy aggregation could move to SQLite later if the JSONL
// volume gets uncomfortable, but for desktop usage (a handful of
// sessions per day) plain Go maps are fine.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/telemetry"
	"github.com/construct-space/brain/wire"
)

type insightsDeps struct {
	BrainDir string
}

type sessionAgg struct {
	id        string
	turns     int
	tokensIn  int
	tokensOut int
	cost      float64
	model     string
	provider  string
	start     time.Time
	end       time.Time
	stop      string
	dur       int64
}

type dailyAgg struct {
	sessions map[string]bool
	turns    int
	tokens   int
	cost     float64
}

func registerInsightsHandlers(s *sidecar.Server, deps insightsDeps) {
	s.Handle("insights.overview", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Days int `json:"days"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		days := pl.Days
		if days <= 0 || days > 365 {
			days = 30
		}
		out, err := aggregateInsights(filepath.Join(deps.BrainDir, "telemetry"), days)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: out, Done: true})
	})
}

func aggregateInsights(telemDir string, days int) (map[string]any, error) {
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour)
	sessions := map[string]*sessionAgg{}
	dailies := map[string]*dailyAgg{}
	totalTokens := 0
	totalCost := 0.0
	totalTurns := 0

	entries, err := os.ReadDir(telemDir)
	if err != nil {
		if os.IsNotExist(err) {
			return emptyInsights(), nil
		}
		return nil, err
	}

	for _, ent := range entries {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".jsonl") {
			continue
		}
		dayStr := strings.TrimSuffix(ent.Name(), ".jsonl")
		day, err := time.Parse("2006-01-02", dayStr)
		if err != nil {
			continue
		}
		if day.Before(cutoff.Truncate(24 * time.Hour)) {
			continue
		}
		path := filepath.Join(telemDir, ent.Name())
		if err := scanTelemetryFile(path, cutoff, sessions, dailies, &totalTokens, &totalCost, &totalTurns); err != nil {
			return nil, err
		}
	}

	dailyHistory := buildDailyHistory(dailies)
	recent := buildRecentSessions(sessions, 20)

	totalSessions := len(sessions)
	avgTurns := 0.0
	avgCost := 0.0
	if totalSessions > 0 {
		avgTurns = float64(totalTurns) / float64(totalSessions)
		avgCost = totalCost / float64(totalSessions)
	}

	return map[string]any{
		"total_sessions":        totalSessions,
		"total_turns":           totalTurns,
		"total_tokens":          totalTokens,
		"total_cost_usd":        totalCost,
		"avg_turns_per_session": avgTurns,
		"avg_cost_per_session":  avgCost,
		// top_agents requires agent_id on telemetry events; emitter
		// doesn't carry it yet. Return [] so the UI renders the empty
		// state instead of stale zeros.
		"top_agents":      []any{},
		"daily_history":   dailyHistory,
		"recent_sessions": recent,
	}, nil
}

func scanTelemetryFile(
	path string,
	cutoff time.Time,
	sessions map[string]*sessionAgg,
	dailies map[string]*dailyAgg,
	totalTokens *int,
	totalCost *float64,
	totalTurns *int,
) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var e telemetry.Event
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			continue
		}
		if e.Time.Before(cutoff) {
			continue
		}
		if e.Type != "turn" {
			continue
		}
		tokens := e.InputTokens + e.OutputTokens
		*totalTokens += tokens
		*totalCost += e.CostUSD
		*totalTurns++

		dayKey := e.Time.Format("2006-01-02")
		d, ok := dailies[dayKey]
		if !ok {
			d = &dailyAgg{sessions: map[string]bool{}}
			dailies[dayKey] = d
		}
		if e.SessionID != "" {
			d.sessions[e.SessionID] = true
		}
		d.turns++
		d.tokens += tokens
		d.cost += e.CostUSD

		if e.SessionID == "" {
			continue
		}
		sess, ok := sessions[e.SessionID]
		if !ok {
			sess = &sessionAgg{id: e.SessionID, start: e.Time, end: e.Time}
			sessions[e.SessionID] = sess
		}
		sess.turns++
		sess.tokensIn += e.InputTokens
		sess.tokensOut += e.OutputTokens
		sess.cost += e.CostUSD
		sess.dur += e.DurationMs
		if e.Model != "" {
			sess.model = e.Model
		}
		if e.Provider != "" {
			sess.provider = e.Provider
		}
		if e.StopReason != "" {
			sess.stop = e.StopReason
		}
		if e.Time.Before(sess.start) {
			sess.start = e.Time
		}
		if e.Time.After(sess.end) {
			sess.end = e.Time
		}
	}
	return sc.Err()
}

func buildDailyHistory(dailies map[string]*dailyAgg) []map[string]any {
	keys := make([]string, 0, len(dailies))
	for k := range dailies {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		d := dailies[k]
		out = append(out, map[string]any{
			"date":           k,
			"sessions":       len(d.sessions),
			"total_turns":    d.turns,
			"total_tokens":   d.tokens,
			"total_cost_usd": d.cost,
		})
	}
	return out
}

func buildRecentSessions(sessions map[string]*sessionAgg, limit int) []map[string]any {
	flat := make([]*sessionAgg, 0, len(sessions))
	for _, s := range sessions {
		flat = append(flat, s)
	}
	sort.Slice(flat, func(i, j int) bool { return flat[i].end.After(flat[j].end) })
	if len(flat) > limit {
		flat = flat[:limit]
	}
	out := make([]map[string]any, 0, len(flat))
	for _, s := range flat {
		out = append(out, map[string]any{
			"id":            s.id,
			"agent_id":      "", // events don't carry it yet
			"start_time":    s.start.Format(time.RFC3339),
			"duration_secs": int(s.dur / 1000),
			"turns":         s.turns,
			"cost_usd":      s.cost,
			"stop_reason":   s.stop,
			"model":         s.model,
			"provider":      s.provider,
		})
	}
	return out
}

func emptyInsights() map[string]any {
	return map[string]any{
		"total_sessions":        0,
		"total_turns":           0,
		"total_tokens":          0,
		"total_cost_usd":        0.0,
		"avg_turns_per_session": 0.0,
		"avg_cost_per_session":  0.0,
		"top_agents":            []any{},
		"daily_history":         []any{},
		"recent_sessions":       []any{},
	}
}
