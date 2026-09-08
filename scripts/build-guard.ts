// If called from tauri's beforeBuildCommand, build frontend only (no recursion).
// Otherwise, run the full `cargo tauri build` for a local full build.
import { spawnSync } from "node:child_process";

const insideTauri = !!(
  process.env.TAURI_ENV_PLATFORM ||
  process.env.TAURI_PLATFORM ||
  process.env.TAURI
);

const cmd = insideTauri
  ? ["bun", "run", "build:frontend"]
  : ["cargo", "tauri", "build", "--features", "voice"];

const result = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
