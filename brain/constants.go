// Package-wide constants. version is the brain binary version (reported
// via system.ping + system.info); defaultModel + defaultSystemPrompt
// are the fallbacks when a prompt arrives with neither field set.
package main

const version = "1.3.1"

// defaultModel is used by handlePrompt + the subagent runner when the
// caller didn't specify a model and the catalog has no default for the
// chosen provider. Points at the Construct gateway's single user-facing
// picker entry — the gateway resolves it server-side via Source Family
// routing, so this works for any user with a valid identity token
// regardless of whether they've added third-party provider keys.
const defaultModel = "source"

// defaultSystemPrompt primes a stock conversation when neither an
// agent_id nor an explicit system prompt was supplied. Brain ships
// the "construct" agent which carries the real prompt; this fallback
// only runs in edge cases (custom-prompt CLI runs, tests). Keep it
// short — the model is doing the heavy lifting, not the prompt.
const defaultSystemPrompt = `You are Construct's coding agent. You read files, edit code, run commands, and verify behavior.

Tools: read, write, edit, bash are visible. list_tools / call_tool expose the hidden ones (grep/glob, git, lsp, web, space.*, etc.). list_skills / load_skill expose loadable domain instructions — use them when a task matches a skill's description.

Be concise. Read before you write. Verify by running, not by reading green output.`
