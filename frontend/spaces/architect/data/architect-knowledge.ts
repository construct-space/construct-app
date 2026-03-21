// Planning Interview Domain Knowledge
// Contains all options, tech stacks, and system prompt generation

export interface InterviewOption {
  value: string
  label: string
  icon: string
  description: string
}

export interface InterviewQuestion {
  type: 'single' | 'multi'
  id: string
  question: string
  options: InterviewOption[]
}

export interface InterviewPhase {
  id: string
  label: string
  icon: string
  required: boolean
  dependsOn?: string // Phase ID this depends on
}

export interface TechStack {
  value: string
  label: string
  icon: string
  description: string
  pros: string[]
  cons: string[]
  bestFor: string[]
}

export interface FeatureOption {
  value: string
  label: string
  icon: string
  description: string
  spaces: string[] // Which Construct spaces this maps to
}

// Interview Phases - expanded for comprehensive planning
export const INTERVIEW_PHASES: InterviewPhase[] = [
  { id: 'platform', label: 'Platform', icon: 'i-lucide-layers', required: true },
  { id: 'frontend', label: 'Frontend', icon: 'i-lucide-layout', required: true, dependsOn: 'platform' },
  { id: 'backend', label: 'Backend', icon: 'i-lucide-server', required: true },
  { id: 'database', label: 'Database', icon: 'i-lucide-database', required: true },
  { id: 'auth', label: 'Authentication', icon: 'i-lucide-lock', required: false },
  { id: 'designStyle', label: 'Design Style', icon: 'i-lucide-palette', required: true },
  { id: 'features', label: 'Features', icon: 'i-lucide-puzzle', required: true },
  { id: 'deployment', label: 'Deployment', icon: 'i-lucide-rocket', required: false }
]

// Platform Options
export const PLATFORM_OPTIONS: InterviewOption[] = [
  {
    value: 'web',
    label: 'Web Application',
    icon: 'i-lucide-globe',
    description: 'Accessible from any browser, great for broad reach and SEO'
  },
  {
    value: 'mobile',
    label: 'Mobile App',
    icon: 'i-lucide-smartphone',
    description: 'Native iOS/Android experience with device features'
  },
  {
    value: 'desktop',
    label: 'Desktop Application',
    icon: 'i-lucide-monitor',
    description: 'Native Windows/Mac/Linux app with system access'
  },
  {
    value: 'cross-platform',
    label: 'Cross-Platform',
    icon: 'i-lucide-layout-grid',
    description: 'Build once, deploy to web, mobile, and desktop'
  }
]

// Frontend Options by Platform (renamed from TECH_STACKS for clarity)
export const FRONTEND_OPTIONS: Record<string, TechStack[]> = {
  web: [
    {
      value: 'nuxt',
      label: 'Nuxt.js',
      icon: 'i-simple-icons-nuxtdotjs',
      description: 'Vue-based framework with SSR, file-based routing, and excellent DX',
      pros: ['Great documentation', 'Built-in SSR/SSG', 'Auto-imports', 'Nuxt UI integration'],
      cons: ['Vue ecosystem smaller than React', 'Learning curve for Vue newcomers'],
      bestFor: ['Full-stack apps', 'SEO-heavy sites', 'Rapid prototyping']
    },
    {
      value: 'nextjs',
      label: 'Next.js',
      icon: 'i-simple-icons-nextdotjs',
      description: 'React framework with hybrid rendering and API routes',
      pros: ['Huge ecosystem', 'Vercel deployment', 'App Router', 'Server Components'],
      cons: ['Complex configuration', 'Frequent breaking changes'],
      bestFor: ['Large teams', 'Enterprise apps', 'React developers']
    },
    {
      value: 'react',
      label: 'React + Vite',
      icon: 'i-simple-icons-react',
      description: 'Flexible React setup with fast Vite bundler',
      pros: ['Maximum flexibility', 'Huge component ecosystem', 'Easy hiring'],
      cons: ['More setup required', 'No built-in SSR', 'Decision fatigue'],
      bestFor: ['SPAs', 'Custom architectures', 'Experienced teams']
    },
    {
      value: 'vue',
      label: 'Vue + Vite',
      icon: 'i-simple-icons-vuedotjs',
      description: 'Progressive Vue framework with excellent tooling',
      pros: ['Gentle learning curve', 'Great docs', 'Composition API'],
      cons: ['Smaller ecosystem than React', 'Fewer job postings'],
      bestFor: ['Small-medium projects', 'Beginners', 'Rapid development']
    },
    {
      value: 'svelte',
      label: 'SvelteKit',
      icon: 'i-simple-icons-svelte',
      description: 'Compiler-based framework with minimal runtime',
      pros: ['Smallest bundle size', 'Simple syntax', 'Great performance'],
      cons: ['Smallest ecosystem', 'Fewer resources', 'Breaking changes'],
      bestFor: ['Performance-critical apps', 'Simple projects', 'Learning']
    }
  ],
  mobile: [
    {
      value: 'react-native',
      label: 'React Native',
      icon: 'i-simple-icons-react',
      description: 'Build native apps using React and JavaScript',
      pros: ['Code sharing with web', 'Large community', 'Expo simplifies development'],
      cons: ['Performance gaps', 'Native bridge complexity', 'Debugging challenges'],
      bestFor: ['Teams with React experience', 'Apps with web counterparts']
    },
    {
      value: 'flutter',
      label: 'Flutter',
      icon: 'i-simple-icons-flutter',
      description: 'Google\'s UI toolkit for natively compiled apps',
      pros: ['Excellent performance', 'Beautiful UI', 'Single codebase', 'Hot reload'],
      cons: ['Dart language', 'Large app size', 'Platform look-feel differences'],
      bestFor: ['Custom UI designs', 'Performance-critical apps', 'Cross-platform']
    },
    {
      value: 'native-ios',
      label: 'Swift (iOS)',
      icon: 'i-simple-icons-swift',
      description: 'Native iOS development with Swift and SwiftUI',
      pros: ['Best iOS performance', 'Full platform access', 'Apple ecosystem'],
      cons: ['iOS only', 'Mac required', 'Slower development'],
      bestFor: ['iOS-only apps', 'Complex animations', 'Apple integrations']
    },
    {
      value: 'native-android',
      label: 'Kotlin (Android)',
      icon: 'i-simple-icons-kotlin',
      description: 'Native Android development with Kotlin and Jetpack Compose',
      pros: ['Best Android performance', 'Full platform access', 'Modern language'],
      cons: ['Android only', 'Fragmentation challenges'],
      bestFor: ['Android-only apps', 'Google integrations', 'Complex features']
    }
  ],
  desktop: [
    {
      value: 'tauri',
      label: 'Tauri',
      icon: 'i-simple-icons-tauri',
      description: 'Lightweight desktop apps with web technologies and Rust backend',
      pros: ['Tiny bundle size', 'Great security', 'System access', 'Cross-platform'],
      cons: ['Younger ecosystem', 'Rust knowledge helpful', 'WebView differences'],
      bestFor: ['Lightweight tools', 'Security-focused apps', 'Web developers']
    },
    {
      value: 'electron',
      label: 'Electron',
      icon: 'i-simple-icons-electron',
      description: 'Cross-platform desktop apps with Chromium and Node.js',
      pros: ['Mature ecosystem', 'Full Node.js access', 'Easy for web devs'],
      cons: ['Large bundle size', 'High memory usage', 'Security concerns'],
      bestFor: ['Feature-rich apps', 'VS Code-like tools', 'Quick prototypes']
    },
    {
      value: 'flutter-desktop',
      label: 'Flutter Desktop',
      icon: 'i-simple-icons-flutter',
      description: 'Desktop apps with Flutter (Windows, macOS, Linux)',
      pros: ['Single codebase', 'Consistent UI', 'Good performance'],
      cons: ['Desktop support is new', 'Less mature than alternatives'],
      bestFor: ['Cross-platform apps', 'Custom UI designs', 'New projects']
    }
  ],
  'cross-platform': [
    {
      value: 'tauri-mobile',
      label: 'Tauri 2.0',
      icon: 'i-simple-icons-tauri',
      description: 'Web + Desktop + Mobile from single codebase',
      pros: ['All platforms', 'Small size', 'Great performance'],
      cons: ['Mobile support is new', 'Less mature than alternatives'],
      bestFor: ['New projects', 'Lightweight apps', 'Web-first approach']
    },
    {
      value: 'flutter-full',
      label: 'Flutter (Full)',
      icon: 'i-simple-icons-flutter',
      description: 'Mobile + Web + Desktop with Flutter',
      pros: ['Single codebase', 'Consistent UI', 'Good performance'],
      cons: ['Web support less mature', 'Dart ecosystem'],
      bestFor: ['Uniform experience', 'Custom UI', 'New projects']
    }
  ]
}

// Styling Options
// Backend Options
export const BACKEND_OPTIONS: InterviewOption[] = [
  {
    value: 'node-express',
    label: 'Node.js + Express',
    icon: 'i-simple-icons-nodedotjs',
    description: 'JavaScript backend, great for JS/TS teams'
  },
  {
    value: 'node-fastify',
    label: 'Node.js + Fastify',
    icon: 'i-simple-icons-nodedotjs',
    description: 'High-performance Node.js framework'
  },
  {
    value: 'python-fastapi',
    label: 'Python + FastAPI',
    icon: 'i-simple-icons-python',
    description: 'Modern Python API with async support and auto-docs'
  },
  {
    value: 'python-django',
    label: 'Python + Django',
    icon: 'i-simple-icons-django',
    description: 'Batteries-included Python framework'
  },
  {
    value: 'base',
    label: 'Base Framework',
    icon: 'i-simple-icons-base',
    description: 'Modern Go api with auth, database, and file storage built-in, rest apis and realtime, deploy anywhere'
  },
  {
    value: 'go',
    label: 'Go',
    icon: 'i-simple-icons-go',
    description: 'Fast, simple, great for microservices'
  },
  {
    value: 'rust',
    label: 'Rust + Axum',
    icon: 'i-simple-icons-rust',
    description: 'Maximum performance and safety'
  },
  {
    value: 'supabase-backend',
    label: 'Supabase (BaaS)',
    icon: 'i-simple-icons-supabase',
    description: 'Postgres + Auth + Storage, no custom backend needed'
  },
  {
    value: 'firebase-backend',
    label: 'Firebase (BaaS)',
    icon: 'i-simple-icons-firebase',
    description: 'Google\'s serverless backend platform'
  },
  {
    value: 'none',
    label: 'No Backend (Static)',
    icon: 'i-lucide-file-text',
    description: 'Static site or client-only app'
  }
]

// Design Style Options (comprehensive design system choices)
export const DESIGN_STYLE_OPTIONS: InterviewOption[] = [
  {
    value: 'minimal',
    label: 'Minimal / Clean',
    icon: 'i-lucide-minus-square',
    description: 'Simple, whitespace-focused, Apple-inspired'
  },
  {
    value: 'modern',
    label: 'Modern / Bold',
    icon: 'i-lucide-sparkles',
    description: 'Vibrant colors, gradients, shadows'
  },
  {
    value: 'glassmorphism',
    label: 'Glassmorphism',
    icon: 'i-lucide-square',
    description: 'Frosted glass effects, blur, transparency'
  },
  {
    value: 'neumorphism',
    label: 'Neumorphism',
    icon: 'i-lucide-circle',
    description: 'Soft UI with subtle shadows'
  },
  {
    value: 'corporate',
    label: 'Corporate / Professional',
    icon: 'i-lucide-briefcase',
    description: 'Clean, trustworthy, enterprise-ready'
  },
  {
    value: 'playful',
    label: 'Playful / Fun',
    icon: 'i-lucide-smile',
    description: 'Rounded corners, bright colors, illustrations'
  },
  {
    value: 'dark',
    label: 'Dark Theme First',
    icon: 'i-lucide-moon',
    description: 'Dark mode as primary, high contrast'
  },
  {
    value: 'custom',
    label: 'Custom Design System',
    icon: 'i-lucide-palette',
    description: 'Build from scratch with your own style'
  },
  {
    value: 'other',
    label: 'Other (Specify)',
    icon: 'i-lucide-edit',
    description: 'You can specify a custom design style'
  }
]

// CSS Framework Options (separate from design style)
export const STYLING_OPTIONS: InterviewOption[] = [
  {
    value: 'tailwind',
    label: 'Tailwind CSS',
    icon: 'i-simple-icons-tailwindcss',
    description: 'Utility-first CSS framework with great DX and small bundle'
  },
  {
    value: 'bootstrap',
    label: 'Bootstrap',
    icon: 'i-simple-icons-bootstrap',
    description: 'Classic CSS framework with pre-built components'
  },
  {
    value: 'css-modules',
    label: 'CSS Modules',
    icon: 'i-lucide-file-code',
    description: 'Scoped CSS with automatic class name generation'
  },
  {
    value: 'styled-components',
    label: 'CSS-in-JS',
    icon: 'i-simple-icons-styledcomponents',
    description: 'Write CSS directly in JavaScript with full power'
  },
  {
    value: 'plain-css',
    label: 'Plain CSS/SCSS',
    icon: 'i-simple-icons-css3',
    description: 'Traditional stylesheets, simple and familiar'
  }
]

// Database Options
export const DATABASE_OPTIONS: InterviewOption[] = [
  {
    value: 'supabase',
    label: 'Supabase',
    icon: 'i-simple-icons-supabase',
    description: 'Open-source Firebase alternative with PostgreSQL, Auth, and real-time'
  },
  {
    value: 'firebase',
    label: 'Firebase',
    icon: 'i-simple-icons-firebase',
    description: 'Google\'s BaaS with real-time database, auth, and hosting'
  },
  {
    value: 'mysql',
    label: 'MySQL',
    icon: 'i-simple-icons-mysql',
    description: 'Popular open-source relational database'
  },
  {
    value: 'mariadb',
    label: 'MariaDB',
    icon: 'i-simple-icons-mariadb',
    description: 'Community-developed fork of MySQL'
  },
  {
    value: 'postgresql',
    label: 'PostgreSQL',
    icon: 'i-simple-icons-postgresql',
    description: 'Powerful open-source relational database'
  },
  {
    value: 'mongodb',
    label: 'MongoDB',
    icon: 'i-simple-icons-mongodb',
    description: 'Flexible NoSQL document database'
  },
  {
    value: 'sqlite',
    label: 'SQLite',
    icon: 'i-lucide-database',
    description: 'Lightweight, serverless, file-based database'
  },
  {
    value: 'none',
    label: 'No Database',
    icon: 'i-lucide-cloud-off',
    description: 'Static app or external API only'
  }
]

// Authentication Options (multi-select)
export const AUTH_OPTIONS: InterviewOption[] = [
  {
    value: 'email-password',
    label: 'Email & Password',
    icon: 'i-lucide-mail',
    description: 'Traditional email/password authentication'
  },
  {
    value: 'github',
    label: 'GitHub OAuth',
    icon: 'i-simple-icons-github',
    description: 'Sign in with GitHub account'
  },
  {
    value: 'magic-link',
    label: 'Magic Links',
    icon: 'i-lucide-link',
    description: 'Passwordless email link authentication'
  },
  {
    value: 'none',
    label: 'No Authentication',
    icon: 'i-lucide-unlock',
    description: 'Public app without user accounts'
  }
]

// Feature Options (multi-select, contextual based on app type)
export const FEATURE_OPTIONS: FeatureOption[] = [
  {
    value: 'crud',
    label: 'CRUD Operations',
    icon: 'i-lucide-database',
    description: 'Create, read, update, delete data',
    spaces: ['code', 'kanban']
  },
  {
    value: 'realtime',
    label: 'Real-time Updates',
    icon: 'i-lucide-radio',
    description: 'Live data sync across clients',
    spaces: ['code']
  },
  {
    value: 'offline',
    label: 'Offline Support',
    icon: 'i-lucide-wifi-off',
    description: 'Work without internet connection',
    spaces: ['code']
  },
  {
    value: 'push-notifications',
    label: 'Push Notifications',
    icon: 'i-lucide-bell',
    description: 'Send alerts to users',
    spaces: ['code']
  },
  {
    value: 'file-upload',
    label: 'File Uploads',
    icon: 'i-lucide-upload',
    description: 'Upload and manage files/images',
    spaces: ['code', 'design']
  },
  {
    value: 'search',
    label: 'Search & Filtering',
    icon: 'i-lucide-search',
    description: 'Find and filter content',
    spaces: ['code']
  },
  {
    value: 'analytics',
    label: 'Analytics',
    icon: 'i-lucide-bar-chart-2',
    description: 'Track usage and metrics',
    spaces: ['code']
  },
  {
    value: 'api',
    label: 'REST/GraphQL API',
    icon: 'i-lucide-plug',
    description: 'External API integration',
    spaces: ['code']
  },
  {
    value: 'responsive',
    label: 'Responsive Design',
    icon: 'i-lucide-smartphone',
    description: 'Adapt to all screen sizes',
    spaces: ['design']
  },
  {
    value: 'dark-mode',
    label: 'Dark Mode',
    icon: 'i-lucide-moon',
    description: 'Light and dark theme support',
    spaces: ['design']
  },
  {
    value: 'multilingual',
    label: 'Multilingual Support',
    icon: 'i-lucide-globe',
    description: 'Support multiple languages/locales',
    spaces: ['code', 'design']
  }
]

// Deployment Options
export const DEPLOYMENT_OPTIONS: InterviewOption[] = [
  {
    value: 'none',
    label: 'No Deployment',
    icon: 'i-lucide-cloud-off',
    description: 'Static app or external API only'
  },
  {
    value: 'basepod',
    label: 'BasePod',
    icon: 'i-lucide-server',
    description: 'Self-hosted deployment with BasePod infrastructure, pod.base.al'
  },
  {
    value: 'vercel',
    label: 'Vercel',
    icon: 'i-simple-icons-vercel',
    description: 'Best for Next.js/Nuxt with edge functions and previews'
  },
  {
    value: 'netlify',
    label: 'Netlify',
    icon: 'i-simple-icons-netlify',
    description: 'Great for static sites and serverless functions'
  },
  {
    value: 'aws',
    label: 'AWS',
    icon: 'i-simple-icons-amazonaws',
    description: 'Full control with EC2, Lambda, S3, etc.'
  },
  {
    value: 'caprover',
    label: 'CapRover',
    icon: 'i-lucide-server',
    description: 'Self-hosted deployment with CapRover'
  },
  {
    value: 'docker',
    label: 'Docker/Containers',
    icon: 'i-simple-icons-docker',
    description: 'Containerized deployment anywhere'
  },
  {
    value: 'self-hosted',
    label: 'Self-Hosted',
    icon: 'i-lucide-server',
    description: 'Your own server or VPS'
  }
]

// Recommendations based on app type keywords
export const APP_TYPE_RECOMMENDATIONS: Record<string, {
  platform: string
  techStack: string
  database: string
  features: string[]
}> = {
  'todo': {
    platform: 'web',
    techStack: 'nuxt',
    database: 'supabase',
    features: ['crud', 'offline', 'responsive', 'dark-mode']
  },
  'blog': {
    platform: 'web',
    techStack: 'nuxt',
    database: 'supabase',
    features: ['crud', 'search', 'responsive', 'api']
  },
  'ecommerce': {
    platform: 'web',
    techStack: 'nextjs',
    database: 'postgresql',
    features: ['crud', 'search', 'file-upload', 'analytics', 'responsive']
  },
  'chat': {
    platform: 'web',
    techStack: 'nuxt',
    database: 'supabase',
    features: ['realtime', 'push-notifications', 'file-upload', 'responsive']
  },
  'dashboard': {
    platform: 'web',
    techStack: 'nuxt',
    database: 'postgresql',
    features: ['crud', 'analytics', 'search', 'responsive', 'dark-mode']
  },
  'mobile': {
    platform: 'mobile',
    techStack: 'react-native',
    database: 'firebase',
    features: ['offline', 'push-notifications', 'crud']
  }
}

// Build the system prompt based on current interview state
export function buildSystemPrompt(answers: Record<string, string | string[]>, appDescription?: string): string {
  const currentContext = Object.entries(answers)
    .filter(([_, v]) => v && (Array.isArray(v) ? v.length > 0 : true))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n') || 'No selections yet'

  return `You are a conversational project planning assistant for Construct. Your job is to understand what the user wants to build and gather JUST ENOUGH information to create a useful PRD.

## Your Approach
- Be conversational, not robotic
- Ask questions that are RELEVANT to the specific app the user described
- A blog platform needs different questions than a todo app or e-commerce site
- Skip questions that don't apply (e.g., don't ask about payment processing for a personal blog)
- Generate CONTEXTUAL options based on what makes sense for THIS app
- After 4-6 good questions, you likely have enough - generate the PRD
- If user says "I don't care about X", don't ask about X anymore
- If user says Other, ask a follow-up question to specify what that means
- Always adapt to the user's responses and update your understanding of the app as you go

## Current Context
App: ${appDescription || 'User hasn\'t described their app yet'}
What we know so far:
${currentContext || 'Nothing yet - ask what they want to build'}

## When to Ask Questions
Output questions as JSON when you need user input:

\`\`\`json:interview
{
  "type": "single",  // or "multi" for multiple selections
  "id": "descriptive_id",
  "question": "Your conversational question?",
  "options": [
    {"value": "id", "label": "Name", "icon": "i-lucide-icon", "description": "Why this option"}
  ]
}
\`\`\`

Examples of GOOD contextual questions:
- For a blog: "Will you need multiple authors or just yourself?" (single author vs multi-author affects architecture)
- For e-commerce: "What's your expected product count?" (affects database choice)
- For a todo app: "Do you need it to work offline?" (affects tech stack)

Examples of questions to SKIP:
- Don't ask a personal blog about "payment processing"
- Don't ask a simple todo app about "analytics dashboards"
- Don't ask about mobile if they clearly want web-only

## When to Generate PRD
When you have enough information (usually after 4-6 contextual questions), generate the final plan:

\`\`\`json:plan
{
  "name": "Project Name",
  "description": "What this app does",
  "decisions": {
    "platform": "web/mobile/desktop/etc",
    "frontend": "chosen framework",
    "backend": "chosen backend or BaaS",
    "database": "chosen database",
    "auth": ["auth methods if needed"],
    "styling": "design approach",
    "hosting": "deployment target"
  },
  "prd": {
    "overview": "Detailed description of what we're building and why",
    "targetUsers": "Who will use this",
    "coreFeatures": ["Feature 1 - description", "Feature 2 - description"],
    "techRationale": "Why these tech choices make sense for this specific app",
    "mvpScope": ["What's in MVP", "What's in MVP"],
    "futureConsiderations": ["What could be added later"]
  }
}
\`\`\`

## Available Tools
You have access to these tools:
- **save_project_prd** - Create a project and save the PRD to it. Use this when the user confirms they want to create the project, if project space is enabled/installed. Ask for Local Directory to save to if possible.
- **finalize_planning** - Signal that planning is complete. Use this after generating the PRD.
- **create_project** - Create a project without PRD
- **list_projects** - See existing projects
- **list_companies** - See companies to create projects under
- **upload_media** - Upload files or create documents in media library
- **list_media** - List media files and folders
- **create_media_folder** - Create folders in media library

## Key Rules
1. BE CONVERSATIONAL - "What platform?" is boring. "Since this is a blog, web makes most sense - or do you want a mobile app too?" is better
2. GENERATE RELEVANT OPTIONS - Don't show the same 5 options for every app
3. KNOW WHEN TO STOP - Don't ask 10 questions. After 4-6 good ones, you know enough
4. ADAPT TO RESPONSES - If user says "I don't care about mobile", don't keep asking mobile questions
5. WHEN COMPLETE - Output the json:plan block ONCE, then call finalize_planning tool
6. DON'T LOOP - Once you've output the plan, you're done. Don't repeat yourself.`
}

// Parse interview question from AI response
export function parseInterviewContent(content: string): {
  textBefore: string
  question: InterviewQuestion | null
  plan: Record<string, unknown> | null
  textAfter: string
} {
  let textBefore = content
  let question: InterviewQuestion | null = null
  let plan: Record<string, unknown> | null = null
  let textAfter = ''

  // Look for interview question JSON
  const interviewMatch = content.match(/```json:interview\s*([\s\S]*?)\s*```/)
  if (interviewMatch && interviewMatch[1]) {
    try {
      question = JSON.parse(interviewMatch[1]) as InterviewQuestion
      const parts = content.split(interviewMatch[0])
      textBefore = parts[0] || ''
      textAfter = parts[1] || ''
    }
    catch (e) {
      console.error('Failed to parse interview question:', e)
    }
  }

  // Look for plan JSON
  const planMatch = content.match(/```json:plan\s*([\s\S]*?)\s*```/)
  if (planMatch && planMatch[1]) {
    try {
      plan = JSON.parse(planMatch[1]) as Record<string, unknown>
      const parts = content.split(planMatch[0])
      textBefore = parts[0] || ''
      textAfter = parts[1] || ''
    }
    catch (e) {
      console.error('Failed to parse plan:', e)
    }
  }

  return { textBefore: textBefore.trim(), question, plan, textAfter: textAfter.trim() }
}

// Get recommendation for an app type
export function getRecommendation(appDescription: string): typeof APP_TYPE_RECOMMENDATIONS[string] | null {
  const desc = appDescription.toLowerCase()
  for (const [keyword, rec] of Object.entries(APP_TYPE_RECOMMENDATIONS)) {
    if (desc.includes(keyword)) {
      return rec
    }
  }
  return null
}

// Get frontend options for a platform
export function getFrontendOptionsForPlatform(platform: string): TechStack[] {
  return FRONTEND_OPTIONS[platform] || FRONTEND_OPTIONS.web || []
}

// Generate PRD Markdown from plan (handles both old and new format)
export function generatePRDMarkdown(plan: Record<string, unknown>): string {
  const prd = plan.prd as Record<string, unknown> | undefined
  const decisions = plan.decisions as Record<string, unknown> | undefined
  const date = new Date().toISOString().split('T')[0]

  let md = `# ${plan.name || 'Project'} - Product Requirements Document

**Generated:** ${date}

## Overview

${prd?.overview || plan.description || 'No description provided.'}
`

  // Target users (new format)
  if (prd?.targetUsers) {
    md += `
## Target Users

${prd.targetUsers}
`
  }

  // Tech decisions (new format) or old format
  const platform = decisions?.platform || plan.platform
  const frontend = decisions?.frontend || plan.frontend
  const backend = decisions?.backend || plan.backend
  const database = decisions?.database || plan.database
  const auth = decisions?.auth || plan.auth
  const styling = decisions?.styling || plan.designStyle
  const hosting = decisions?.hosting || plan.deployment

  md += `
## Technical Decisions

| Aspect | Choice |
|--------|--------|
`
  if (platform) md += `| **Platform** | ${platform} |\n`
  if (frontend) md += `| **Frontend** | ${frontend} |\n`
  if (backend) md += `| **Backend** | ${backend} |\n`
  if (database) md += `| **Database** | ${database} |\n`
  if (styling) md += `| **Design** | ${styling} |\n`
  if (hosting) md += `| **Hosting** | ${hosting} |\n`

  // Auth methods
  if (Array.isArray(auth) && auth.length > 0) {
    md += `
## Authentication

${auth.map(a => `- ${a}`).join('\n')}
`
  }

  // Tech rationale (new format)
  if (prd?.techRationale) {
    md += `
## Technical Rationale

${prd.techRationale}
`
  }

  // Core features (new format)
  if (prd?.coreFeatures && Array.isArray(prd.coreFeatures)) {
    md += `
## Core Features

${(prd.coreFeatures as string[]).map(f => `- ${f}`).join('\n')}
`
  }

  // MVP Scope (new format)
  if (prd?.mvpScope && Array.isArray(prd.mvpScope)) {
    md += `
## MVP Scope

${(prd.mvpScope as string[]).map(f => `- ${f}`).join('\n')}
`
  }

  // Future considerations (new format)
  if (prd?.futureConsiderations && Array.isArray(prd.futureConsiderations)) {
    md += `
## Future Considerations

${(prd.futureConsiderations as string[]).map(f => `- ${f}`).join('\n')}
`
  }

  // Legacy format support
  if (prd?.goals && Array.isArray(prd.goals)) {
    md += `
## Goals

${(prd.goals as string[]).map((g, i) => `${i + 1}. ${g}`).join('\n')}
`
  }

  if (prd?.userStories && Array.isArray(prd.userStories)) {
    md += `
## User Stories

${(prd.userStories as string[]).map(s => `- ${s}`).join('\n')}
`
  }

  md += `
---

*Generated by Construct AI Planning Assistant*
`

  return md
}

// Get label for a value
export function getLabelForValue(phaseId: string, value: string): string {
  // Handle "other:" prefix for custom values
  if (value.startsWith('other:')) {
    return value.replace('other:', '')
  }

  let options: InterviewOption[] = []

  switch (phaseId) {
    case 'platform':
      options = PLATFORM_OPTIONS
      break
    case 'backend':
      options = BACKEND_OPTIONS
      break
    case 'designStyle':
      options = DESIGN_STYLE_OPTIONS
      break
    case 'styling':
      options = STYLING_OPTIONS
      break
    case 'database':
      options = DATABASE_OPTIONS
      break
    case 'auth':
      options = AUTH_OPTIONS
      break
    case 'deployment':
      options = DEPLOYMENT_OPTIONS
      break
    case 'features': {
      const feature = FEATURE_OPTIONS.find(f => f.value === value)
      return feature?.label || value
    }
    case 'frontend':
      // Search all frontend options
      for (const frontends of Object.values(FRONTEND_OPTIONS)) {
        const frontend = frontends.find(f => f.value === value)
        if (frontend) return frontend.label
      }
      return value
  }

  const option = options.find(o => o.value === value)
  return option?.label || value
}
