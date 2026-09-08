//! Augment $PATH at app startup so child processes (operator, spaceprobe via
//! `space_binary.rs`, the shell tool, anything spawned by the bash-style
//! integrations) can find user-installed binaries.
//!
//! macOS GUI apps inherit the launchd PATH — typically `/usr/bin:/bin:/usr/sbin:/sbin`
//! — NOT the user's interactive shell PATH. `.zshrc` / `.bash_profile` never
//! run for Finder-launched apps, so anything installed under `/opt/homebrew/bin`
//! (the Apple-Silicon Homebrew prefix), `/usr/local/bin` (Intel Homebrew),
//! `~/.bun/bin`, `~/.cargo/bin`, `~/.local/bin`, `~/go/bin` is invisible to
//! every subprocess. Result: `ffmpeg`, `construct`, `bun`, `cargo`, `go`, etc.
//! all fail with "command not found" even though the user has them installed.
//!
//! This module patches `std::env::PATH` once at startup, before any subprocess
//! spawns. Tauri's plugins, the operator sidecar, the bash tool, and Rust-side
//! `Command::new(...)` calls all inherit the augmented value.
//!
//! Unix-only. Windows GUI apps already inherit the user's PATH from the
//! Environment Variables registry, and our `:`-separator + Unix path layout
//! would corrupt a Windows PATH (`C:\Foo;C:\Bar` doesn't split on `:`).
//! `augment()` is a no-op on non-Unix targets.

pub fn augment() {
    #[cfg(unix)]
    augment_unix();
}

#[cfg(unix)]
fn augment_unix() {
    use std::env;
    use std::path::Path;

    let mut paths: Vec<String> = env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();

    let mut prepend: Vec<String> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        prepend.push("/opt/homebrew/bin".into());
        prepend.push("/opt/homebrew/sbin".into());
    }
    prepend.push("/usr/local/bin".into());
    prepend.push("/usr/local/sbin".into());

    if let Ok(home) = env::var("HOME") {
        for sub in [".bun/bin", ".cargo/bin", ".local/bin", "go/bin"] {
            prepend.push(format!("{}/{}", home, sub));
        }
    }

    let before = paths.len();
    for p in prepend.into_iter().rev() {
        if Path::new(&p).is_dir() && !paths.iter().any(|x| x == &p) {
            paths.insert(0, p);
        }
    }
    let added = paths.len() - before;

    let new_path = paths.join(":");
    env::set_var("PATH", &new_path);
    eprintln!(
        "[path_env] augmented PATH (+{} entries, {} total)",
        added,
        paths.len()
    );
}
