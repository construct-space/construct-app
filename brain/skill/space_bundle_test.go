package skill

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSpaceSkillUsesBundleNameAsDefaultID(t *testing.T) {
	root := t.TempDir()
	skillPath := filepath.Join(root, "mail.space", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: Mail\ndescription: Work with mail\n---\n\nUse mail actions.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	s, err := LoadSpaceSkill(skillPath)
	if err != nil {
		t.Fatalf("LoadSpaceSkill() error = %v", err)
	}
	if s.ID != "mail" {
		t.Fatalf("ID = %q, want mail", s.ID)
	}
	if s.Name != "Mail" {
		t.Fatalf("Name = %q, want Mail", s.Name)
	}
	if s.Source != filepath.Join(root, "mail.space") {
		t.Fatalf("Source = %q", s.Source)
	}
}

func TestLoadSpaceSkillsGlobOnlyReadsSpaceBundles(t *testing.T) {
	root := t.TempDir()
	mustWriteSkill(t, filepath.Join(root, "mail.space", "SKILL.md"), "Mail")
	mustWriteSkill(t, filepath.Join(root, "board", "SKILL.md"), "Board")

	got := LoadSpaceSkillsGlob(filepath.Join(root, "*.space", "SKILL.md"))
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].ID != "mail" {
		t.Fatalf("ID = %q, want mail", got[0].ID)
	}
}

func mustWriteSkill(t *testing.T, path string, name string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("---\nname: "+name+"\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}
