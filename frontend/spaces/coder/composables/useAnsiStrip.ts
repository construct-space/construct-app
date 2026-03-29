/**
 * Shared ANSI escape code stripping utility.
 * Used by useRunState, RunControls, and responsive preview.
 */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|.)/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}
