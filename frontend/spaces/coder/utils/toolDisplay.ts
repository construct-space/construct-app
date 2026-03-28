import type { ToolActivity } from '@/operator/useStreamStatus'

const TOOL_NAMES: Record<string, string> = {
  bash: 'Bash',
  write_file: 'Write',
  edit_file: 'Edit',
  read_file: 'Read',
  list_dir: 'List',
  glob: 'Glob',
  grep: 'Grep',
  search: 'Search',
  spawn_agent: 'Agent',
  space_check: 'Check',
  space_build: 'Build',
  space_create: 'Create',
  space_list_installed: 'Spaces',
  space_list_actions: 'Actions',
  space_run_action: 'Run',
}

function truncate(text: string, max: number) {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max).trimEnd() + '\u2026'
}

function parseInput(call: ToolActivity) {
  if (!call.input) return null
  try {
    return typeof call.input === 'string' ? JSON.parse(call.input) : call.input
  } catch {
    return null
  }
}

export function getToolDisplay(call: ToolActivity) {
  const parsed = parseInput(call)
  let primaryArg = ''

  if (parsed && typeof parsed === 'object') {
    switch (call.tool) {
      case 'bash':
        primaryArg = typeof parsed.command === 'string' ? parsed.command : ''
        break
      case 'write_file':
      case 'edit_file':
      case 'read_file':
      case 'list_dir':
        primaryArg = typeof parsed.path === 'string' ? parsed.path : ''
        break
      case 'glob':
      case 'grep':
      case 'search':
        primaryArg = typeof parsed.pattern === 'string' ? parsed.pattern : ''
        break
      case 'spawn_agent':
        primaryArg = typeof parsed.agent_id === 'string' ? parsed.agent_id : ''
        break
      default: {
        const first = Object.values(parsed).find(v => typeof v === 'string' && v.trim())
        primaryArg = typeof first === 'string' ? first : ''
      }
    }
  }

  const displayName = TOOL_NAMES[call.tool] || call.tool
  const shortArg = truncate(primaryArg, 80)

  return {
    displayName,
    primaryArg,
    shortArg,
    hasDetails: primaryArg.length > 80 || !!call.result,
  }
}
