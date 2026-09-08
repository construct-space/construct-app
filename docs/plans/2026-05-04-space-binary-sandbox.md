# Space Tool Syscall Sandbox

**Status:** TODO — deferred from the 2026-05-04 host hardening pass.

## Background

`construct-app/desktop/src/space_binary.rs` runs first-party tools shipped
inside installed spaces (`tools/<os>-<arch>/<name>`). Those tools may call
third-party helpers from `lib/<os>-<arch>/`. On 2026-05-04 it was hardened
with: path-traversal guards, hardlink refusal (Unix), env scrubbing, output
caps (10 MiB/stream), and a 30 s default / 5 min max wall-clock timeout.

These are **path-control + resource caps**, not a syscall sandbox. A tool
that gets executed still runs with the user's full ambient privileges:
read any file the user can read, network access, etc.

## What's missing

A real OS-level sandbox so a malicious or compromised space tool can't:

- Read arbitrary user files (`~/.ssh/id_rsa`, `~/Documents/*`)
- Open outbound network sockets to attacker-controlled hosts
- Spawn long-lived background processes that outlive the parent
- Touch files outside the space's own data dir

## Per-platform plan

### macOS — `sandbox-exec`

Profile-based; ships with the OS. Wrap the child in
`sandbox-exec -p <profile> -- <real_tool> <args>`. Profile allows:

- read/write under `<profile_data_dir>/spaces/<space_id>/`
- read system frameworks + Homebrew/system tool paths used during cmd resolution
- network: deny by default; opt-in per space via manifest declaration
- deny mach lookups except a small allowlist (Apple ships these via
  `/System/Library/Sandbox/Profiles/`; reference `bsd.sb`, `application.sb`)

Notes:
- `sandbox-exec` is technically deprecated since macOS 10.10, but every
  Apple-shipped daemon still uses it and there is no public replacement
  (Endpoint Security framework is for monitoring, not confinement). It
  works on macOS 15 today.
- Profile language is SBPL (Scheme dialect). Build the profile from a
  template + the resolved space dir at exec time.
- `posix_spawn` with `POSIX_SPAWN_SETSIGDEF` to ensure no signal masks leak
  in (mostly cosmetic).

### Linux — `bubblewrap` + seccomp

Bubblewrap (`bwrap`) is in most distro repos. Wrap with:

- `--unshare-all --share-net` (or omit `--share-net` for offline-by-default)
- `--ro-bind /usr /usr` (system libs)
- `--bind <space_dir> <space_dir>` (writable scratch)
- `--proc /proc --dev /dev`
- `--die-with-parent` (kill child if Construct dies)
- `--seccomp <fd>` with a precompiled BPF program denying `ptrace`,
  `process_vm_*`, mount syscalls, BPF loading

Fallback when `bwrap` isn't installed:
- Refuse to run tools (with a clear "install bubblewrap to enable space
  tools" message).
- OR: run unsandboxed but require an explicit-opt-in setting flag. Don't
  silently degrade — that's the worst outcome.

### Windows — AppContainer

Hardest of the three:

- `CreateRestrictedToken` + `CreateProcessAsUser` with an AppContainer SID
- File-system ACL the space dir to grant the container SID R/W
- Disable network capability by omitting `INTERNET_CLIENT` capability
- Job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` so children die with
  the job

This is multiple weeks of work and there are very few good rust crates for
it (`windows-rs` has the raw bindings but no high-level helper). Defer
until macOS/Linux ship.

## Manifest opt-in

Add to `space.manifest.json`:

```jsonc
{
  "capabilities": {
    "tools": {
      "network": false,        // deny outbound by default
      "extra_read_paths": []   // future: opt-in extra reads, with review
    }
  }
}
```

Validator should reject unknown capability keys so we can extend without
breaking old hosts.

## First-run consent

Independent of sandboxing: the first time a space invokes a tool, the
host should prompt the user with the tool path + checksum and require
explicit allow. Store the decision in profile settings keyed by
`(space_id, tool_name, sha256)` so an updated tool re-prompts.

This is cheaper than the sandbox work and probably ships first. Tracked
here so we don't lose track of the relationship.

## Acceptance criteria

When this lands:

- [ ] macOS: a space tool cannot read `~/Documents` or `~/.ssh`
- [ ] macOS: a space tool cannot connect to `attacker.example.com` unless
      the manifest declared `capabilities.tools.network: true`
- [ ] Linux: same two properties via `bwrap`
- [ ] Falling back / unsandboxed runs require an explicit opt-in flag
- [ ] First-run consent UI lives in Settings, decision is persisted

## References

- `construct-app/desktop/src/space_binary.rs` — current implementation
- `construct-app/frontend/composables/useSpaceTool.ts` — TS surface
- `packages/construct-cli/src/commands/build.ts` — `tools/` and `lib/` asset packing
- `packages/construct-cli/src/commands/run.ts` — install + chmod walk
- macOS sandbox profiles: `/System/Library/Sandbox/Profiles/*.sb`
- bubblewrap manpage + Flatpak's seccomp filters as a reference profile
