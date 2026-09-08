// profile_state.go — live, swappable view of per-profile artifacts.
//
// At boot we read skills + hooks + paths once and stash them here. The
// frontend can call the `profile.switch` wire op with a new data_dir to
// trigger a re-scan; readers (wire handlers, prompt deps) atomically pick
// up the new values without restart.
//
// Scope today: skills (dir + bundle), hooks, paths. Auth, sessions,
// state, OAuth storage and catalog credentials still bind at boot and
// would need their own swap to fully follow the profile. Documented on
// the wire op itself so callers know what's actually swapped.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/construct-space/brain/hook"
	"github.com/construct-space/brain/paths"
	"github.com/construct-space/brain/skill"
)

type profileSnapshot struct {
	Paths  paths.Paths
	Skills []skill.Skill
	Hooks  *hook.Set
}

var liveProfile atomic.Pointer[profileSnapshot]

func storeProfile(snap *profileSnapshot) {
	liveProfile.Store(snap)
}

func currentSkills() []skill.Skill {
	if snap := liveProfile.Load(); snap != nil {
		return snap.Skills
	}
	return nil
}

func currentHooks() *hook.Set {
	if snap := liveProfile.Load(); snap != nil {
		return snap.Hooks
	}
	return nil
}

func currentPaths() paths.Paths {
	if snap := liveProfile.Load(); snap != nil {
		return snap.Paths
	}
	return paths.Paths{}
}

// reloadSkillsAndHooks scans the given data dir for skills + bundles +
// hooks. Returns a fresh snapshot ready to be Store'd; doesn't swap on
// its own so the caller decides commit ordering.
func reloadSkillsAndHooks(p paths.Paths, explicitDirs []string) *profileSnapshot {
	dirs := resolveSkillDirs(explicitDirs, p)
	skills := skill.LoadDirs(dirs...)

	spaceSkillPattern := filepath.Join(p.DataDir, "spaces", "*.space", "SKILL.md")
	spaceSkills := skill.LoadSpaceSkillsGlob(spaceSkillPattern)
	if len(spaceSkills) > 0 {
		seen := make(map[string]bool, len(skills))
		for _, s := range skills {
			seen[s.ID] = true
		}
		for _, s := range spaceSkills {
			if seen[s.ID] {
				continue
			}
			seen[s.ID] = true
			skills = append(skills, s)
		}
	}

	hooks := loadHooks(dirs)

	fmt.Fprintf(os.Stderr, "[brain] profile=%s skills=%d (dirs=%d spaces=%d)\n",
		p.DataDir, len(skills), len(dirs), len(spaceSkills))
	return &profileSnapshot{Paths: p, Skills: skills, Hooks: hooks}
}
