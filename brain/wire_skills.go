// Skills (and hook) wire ops for the Settings UI. The frontend's useSkills
// composable was wired to the retired operator context-service; these are the
// brain-native equivalents it now calls via brain.request(...).
//
// Fully implemented: skills.list (in wire_meta), skills.save, skills.delete,
// skills.get. The rest (enable/disable/load/metrics, hooks.*) are graceful
// stubs so the page degrades instead of erroring — they're follow-up work.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/skill"
	"github.com/construct-space/brain/tool"
	"github.com/construct-space/brain/wire"
)

// skillInfos maps loaded skills to the SkillInfo shape the frontend expects.
// `source` comes from the frontmatter Origin ("agent" for skill_manage-created
// skills), so the UI can badge agent-created skills.
func skillInfos(skills []skill.Skill) []map[string]any {
	out := make([]map[string]any, 0, len(skills))
	for _, s := range skills {
		src := s.Origin
		if src == "" {
			src = "user"
		}
		out = append(out, map[string]any{
			"id":           s.ID,
			"name":         s.Name,
			"description":  s.Description,
			"category":     s.Category,
			"version":      "",
			"state":        "active",
			"dependencies": []string{},
			"hooksCount":   0,
			"toolsCount":   0,
			"source":       src,
			"path":         s.Path,
		})
	}
	return out
}

func registerSkillsHandlers(s *sidecar.Server, reg *tool.SkillRegistry) {
	reloadProfile := func() {
		p := currentPaths()
		if p.DataDir == "" {
			return
		}
		storeProfile(reloadSkillsAndHooks(p, activeSkillDirs))
	}
	findByID := func(id string) (skill.Skill, bool) {
		for _, sk := range currentSkills() {
			if sk.ID == id {
				return sk, true
			}
		}
		return skill.Skill{}, false
	}

	// skills.save {filename, content} — write a SKILL.md to the profile skills
	// dir and reload so it shows in the list (and load_skill index).
	s.Handle("skills.save", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Filename string `json:"filename"`
			Content  string `json:"content"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if strings.TrimSpace(pl.Filename) == "" || strings.TrimSpace(pl.Content) == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "filename and content are required", Done: true})
			return
		}
		dir := currentPaths().SkillsDir
		name := filepath.Base(pl.Filename)
		if !strings.HasSuffix(name, ".md") {
			name += ".md"
		}
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		if err := os.WriteFile(path, []byte(pl.Content), 0o644); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		parsed, _ := skill.ParseFile(path)
		if reg != nil {
			reg.Add(tool.SkillEntry{ID: parsed.ID, Name: parsed.Name, Description: parsed.Description, Path: path})
		}
		reloadProfile()
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"id": parsed.ID, "name": parsed.Name, "path": path}, Done: true})
	})

	// skills.delete {id} — archive (never hard-delete) and reload.
	s.Handle("skills.delete", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		sk, ok := findByID(pl.ID)
		if !ok || sk.Path == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "skill not found", Done: true})
			return
		}
		// Archive the file (or its SKILL.md dir) under <SkillsDir>/.archive.
		src := sk.Path
		if filepath.Base(src) == "SKILL.md" {
			src = filepath.Dir(src)
		}
		archive := filepath.Join(currentPaths().SkillsDir, ".archive", fmt.Sprintf("%s-%d", filepath.Base(src), time.Now().Unix()))
		if err := os.MkdirAll(filepath.Dir(archive), 0o755); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		if err := os.Rename(src, archive); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		reloadProfile()
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})

	// skills.get {id} — return one skill with its full markdown content.
	s.Handle("skills.get", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		sk, ok := findByID(pl.ID)
		if !ok {
			emit(wire.Response{ID: req.ID, Success: false, Error: "skill not found", Done: true})
			return
		}
		content, _ := os.ReadFile(sk.Path)
		info := skillInfos([]skill.Skill{sk})[0]
		info["content"] = string(content)
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"skill": info}, Done: true})
	})

	// Graceful stubs — the UI calls these; brain has no per-skill runtime
	// enable/disable or metrics yet. Return success/empty so buttons don't
	// error. Follow-up: real disabled-set persistence + usage metrics.
	okStub := func(op string) {
		s.Handle(op, func(_ context.Context, req wire.Request, emit func(wire.Response)) {
			emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
		})
	}
	okStub("skills.enable")
	okStub("skills.disable")
	okStub("skills.load")
	okStub("skills.unload")
	okStub("skills.load_builtins")
	s.Handle("skills.metrics", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": []any{}}, Done: true})
	})

	// Hooks settings: empty for now (brain loads hooks but doesn't expose a
	// manage API yet). Empty beats the current "command not found" error.
	emptyHooks := func(op string) {
		s.Handle(op, func(_ context.Context, req wire.Request, emit func(wire.Response)) {
			emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"hooks": []any{}}, Done: true})
		})
	}
	emptyHooks("hooks.list")
	emptyHooks("hooks.by_type")
	okStub("hooks.enable")
	okStub("hooks.disable")
	okStub("hooks.save")
	okStub("hooks.delete")
	s.Handle("hooks.metrics", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": []any{}}, Done: true})
	})
}
