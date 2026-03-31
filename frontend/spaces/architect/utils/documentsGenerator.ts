/**
 * Architect Plan Types
 *
 * Type definitions for the Architect plan structure.
 * Document generation is handled by the docs agent (space-docs)
 * which writes numbered docs directly via write_file.
 *
 * The doc set is ADAPTIVE — the Architect selects which docs to generate
 * based on what it learned during the interview. See `PROJECT_TYPE_DOCS`
 * for the mapping of project types to recommended doc sets.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type DocumentType = 'prd' | 'readme' | 'architecture' | 'data-models' | 'ui-spec' | 'roadmap' | 'ai-context' | 'setup' | 'endpoints'

/**
 * Recommended doc sets per project type.
 * The Architect agent uses this as a guide — it may add or remove docs
 * based on the specific interview answers.
 */
export const PROJECT_TYPE_DOCS: Record<string, DocumentType[]> = {
  'landing-page': ['prd', 'ui-spec', 'readme'],
  'web-app': ['prd', 'architecture', 'ui-spec', 'data-models', 'readme'],
  'web-app-complex': ['prd', 'architecture', 'ui-spec', 'data-models', 'endpoints', 'roadmap', 'setup', 'ai-context', 'readme'],
  'mobile-app': ['prd', 'architecture', 'ui-spec', 'data-models', 'roadmap', 'readme'],
  'api': ['prd', 'architecture', 'data-models', 'endpoints', 'setup', 'readme'],
  'game': ['prd', 'architecture', 'readme'],
  'cli-tool': ['prd', 'architecture', 'setup', 'readme'],
  'construct-space': ['prd', 'ui-spec', 'readme'],
}

export interface ArchitectPlan {
  name: string
  description: string
  type?: 'construct-space' | 'project'
  spaceId?: string
  spaceName?: string
  spaceScope?: 'project' | 'app' | 'both'
  spaceIcon?: string
  decisions: {
    platform?: string
    frontend?: string
    backend?: string
    database?: string
    auth?: string | string[]
    styling?: string
    hosting?: string
    spaces?: string[]
    [key: string]: string | string[] | undefined
  }
  techStack?: {
    framework?: string
    styling?: string
    animations?: string
    backend?: string
    database?: string
    hosting?: string
    key_libraries?: string[]
  }
  // Legacy flat PRD — backward compat
  prd?: {
    overview?: string
    targetUsers?: string
    coreFeatures?: string[]
    techRationale?: string
    mvpScope?: string[]
    futureConsiderations?: string[]
    designNotes?: string
    sections?: string[]
    contentStructure?: string
  }
  // Rich docs (v2) — kept for plan metadata
  docs?: {
    prd?: {
      overview?: string
      targetUsers?: string
      coreFeatures?: string[]
      userFlows?: string[]
      mvpScope?: string[]
      contentStructure?: string
      futureConsiderations?: string[]
    }
    architecture?: Record<string, unknown>
    dataModels?: Record<string, unknown>
    uiSpec?: Record<string, unknown>
    roadmap?: Record<string, unknown>
    aiContext?: Record<string, unknown>
  }
}

export interface DocumentOption {
  type: DocumentType
  label: string
  description: string
  icon: string
  default: boolean
}

/**
 * @deprecated Fixed doc menu — the Architect now selects docs adaptively
 * based on project type. Kept for backward compatibility with existing UI
 * that may reference it. Use PROJECT_TYPE_DOCS for new code.
 * TODO(0.8): Remove this fixed list.
 */
export const DOCUMENT_OPTIONS: DocumentOption[] = [
  {
    type: 'prd',
    label: 'Product Requirements',
    description: 'Detailed product requirements, user flows, and MVP scope',
    icon: 'i-lucide-file-text',
    default: true
  },
  {
    type: 'readme',
    label: 'README',
    description: 'Project overview, tech stack, and getting started',
    icon: 'i-lucide-book-open',
    default: true
  },
  {
    type: 'architecture',
    label: 'Architecture',
    description: 'System design, data flow, constraints, and tech rationale',
    icon: 'i-lucide-git-branch',
    default: true
  },
  {
    type: 'data-models',
    label: 'Data Models',
    description: 'Entity schemas, relationships, enums, and API contracts',
    icon: 'i-lucide-database',
    default: false
  },
  {
    type: 'ui-spec',
    label: 'UI Specification',
    description: 'Design system, screens, animations, and responsive rules',
    icon: 'i-lucide-palette',
    default: false
  },
  {
    type: 'roadmap',
    label: 'Roadmap',
    description: 'Phased delivery plan with tasks and definition of done',
    icon: 'i-lucide-map',
    default: true
  },
  {
    type: 'ai-context',
    label: 'AI Context',
    description: 'Agent guide: conventions, patterns, key files, common mistakes',
    icon: 'i-lucide-brain',
    default: true
  },
  {
    type: 'setup',
    label: 'Setup',
    description: 'Development environment setup instructions',
    icon: 'i-lucide-settings',
    default: false
  }
]
