/**
 * Code Space - Template Configuration
 *
 * Defines all supported project templates with their creation,
 * install, dev, and build commands.
 */

export interface TemplateCommand {
  cmd: string
  args: string[]
  // Optional: run in project directory after creation
  cwd?: 'parent' | 'project'
}

// Optional modules that can be added during project creation
export interface TemplateModule {
  id: string
  name: string
  icon?: string
  description?: string
  // Package name to install
  package: string
  // Whether it's recommended/popular
  recommended?: boolean
  // Dev dependency?
  dev?: boolean
}

// Required tool information
export interface RequiredTool {
  command: string           // The command to check (e.g., 'flutter', 'bun')
  name: string              // Human-readable name
  installUrl?: string       // URL for installation instructions
  installHint?: string      // Short hint for installation
}

export interface TemplateConfig {
  id: string
  name: string
  icon: string
  category: 'frontend' | 'mobile' | 'backend' | 'fullstack'

  // Package manager (for install/run commands)
  packageManager: 'bun' | 'npm' | 'yarn' | 'pnpm' | 'composer' | 'pip' | 'flutter' | 'none'

  // Required tools that must be installed to create this template
  requiredTools?: RequiredTool[]

  // Create command - {name} will be replaced with project name
  create: {
    cmd: string
    args: string[]
    // Extra args for non-interactive mode
    nonInteractive?: string[]
    // Extra args to skip git init (when user unchecks git)
    skipGit?: string[]
    // Whether this template inits git by default
    initsGit?: boolean
  }

  // Commands to run in the created project
  commands: {
    install?: string[]    // e.g., ['bun', 'install']
    dev?: string[]        // e.g., ['bun', 'run', 'dev']
    build?: string[]      // e.g., ['bun', 'run', 'build']
    start?: string[]      // e.g., ['bun', 'run', 'start']
    test?: string[]       // e.g., ['bun', 'test']
  }

  // Files/folders that identify this template type
  identifiers?: string[]

  // Description shown in UI
  description?: string

  // Optional modules that can be selected during creation
  modules?: TemplateModule[]

  // Whether this is a user-defined custom template
  custom?: boolean
}

export const templates: TemplateConfig[] = [
  // ============================================
  // FRONTEND
  // ============================================
  {
    id: 'nuxt',
    name: 'Nuxt',
    icon: 'i-simple-icons-nuxtdotjs',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', '--bun', 'nuxi@latest', 'init', '{name}', '--template', 'minimal', '--packageManager', 'bun', '--modules', '', '--gitInit'],
      nonInteractive: ['--no-install'],
      skipGit: ['--no-gitInit'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'preview'],
    },
    identifiers: ['nuxt.config.ts', 'nuxt.config.js'],
    description: 'Vue-based full-stack framework',
    modules: [
      {
        id: 'ui',
        name: 'Nuxt UI',
        icon: 'i-simple-icons-nuxtdotjs',
        description: 'Beautiful UI components',
        package: '@nuxt/ui',
        recommended: true,
      },
      {
        id: 'icon',
        name: 'Nuxt Icon',
        icon: 'i-lucide-smile',
        description: '200k+ icons from Iconify',
        package: '@nuxt/icon',
        recommended: true,
      },
      {
        id: 'image',
        name: 'Nuxt Image',
        icon: 'i-lucide-image',
        description: 'Optimized images',
        package: '@nuxt/image',
      },
      {
        id: 'fonts',
        name: 'Nuxt Fonts',
        icon: 'i-lucide-type',
        description: 'Font optimization',
        package: '@nuxt/fonts',
      },
      {
        id: 'content',
        name: 'Nuxt Content',
        icon: 'i-lucide-file-text',
        description: 'File-based CMS',
        package: '@nuxt/content',
      },
      {
        id: 'pinia',
        name: 'Pinia',
        icon: 'i-simple-icons-pinia',
        description: 'State management',
        package: '@pinia/nuxt',
      },
      {
        id: 'vueuse',
        name: 'VueUse',
        icon: 'i-simple-icons-vue-dot-js',
        description: 'Vue composition utilities',
        package: '@vueuse/nuxt',
      },
      {
        id: 'color-mode',
        name: 'Color Mode',
        icon: 'i-lucide-sun-moon',
        description: 'Dark mode support',
        package: '@nuxtjs/color-mode',
      },
      {
        id: 'tailwind',
        name: 'Tailwind CSS',
        icon: 'i-simple-icons-tailwindcss',
        description: 'Utility-first CSS',
        package: '@nuxtjs/tailwindcss',
      },
      {
        id: 'eslint',
        name: 'ESLint',
        icon: 'i-simple-icons-eslint',
        description: 'Linting with @antfu/eslint-config',
        package: '@nuxt/eslint',
        dev: true,
      },
    ],
  },
  {
    id: 'next',
    name: 'Next.js',
    icon: 'i-simple-icons-nextdotjs',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-next-app@latest', '{name}', '--ts', '--eslint', '--tailwind', '--src-dir', '--app', '--import-alias', '@/*', '--use-bun'],
      nonInteractive: ['--yes'],
      skipGit: ['--skip-git'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'start'],
    },
    identifiers: ['next.config.js', 'next.config.ts', 'next.config.mjs'],
    description: 'React framework with SSR/SSG',
    modules: [
      { id: 'next-auth', name: 'NextAuth.js', icon: 'i-lucide-lock', description: 'Authentication for Next.js', package: 'next-auth', recommended: true },
      { id: 'prisma', name: 'Prisma', icon: 'i-simple-icons-prisma', description: 'Type-safe database ORM', package: 'prisma', dev: true },
      { id: 'trpc', name: 'tRPC', icon: 'i-lucide-zap', description: 'End-to-end type-safe APIs', package: '@trpc/server' },
      { id: 'zustand', name: 'Zustand', icon: 'i-lucide-database', description: 'Lightweight state management', package: 'zustand', recommended: true },
      { id: 'react-query', name: 'TanStack Query', icon: 'i-lucide-refresh-cw', description: 'Async state management', package: '@tanstack/react-query' },
      { id: 'shadcn', name: 'shadcn/ui', icon: 'i-lucide-palette', description: 'Re-usable UI components', package: 'class-variance-authority' },
      { id: 'next-intl', name: 'next-intl', icon: 'i-lucide-globe', description: 'Internationalization', package: 'next-intl' },
      { id: 'zod', name: 'Zod', icon: 'i-lucide-shield-check', description: 'Schema validation', package: 'zod' },
    ],
  },
  {
    id: 'vite-vue',
    name: 'Vite + Vue',
    icon: 'i-simple-icons-vite',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['create', 'vite', '{name}', '--template', 'vue-ts'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'preview'],
    },
    identifiers: ['vite.config.ts', 'vite.config.js'],
    description: 'Fast Vue 3 development with Vite',
    modules: [
      { id: 'vue-router', name: 'Vue Router', icon: 'i-lucide-route', description: 'Official Vue router', package: 'vue-router', recommended: true },
      { id: 'pinia', name: 'Pinia', icon: 'i-simple-icons-pinia', description: 'State management', package: 'pinia', recommended: true },
      { id: 'vueuse', name: 'VueUse', icon: 'i-simple-icons-vue-dot-js', description: 'Vue composition utilities', package: '@vueuse/core' },
      { id: 'tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: 'tailwindcss', dev: true },
      { id: 'unplugin-icons', name: 'Unplugin Icons', icon: 'i-lucide-smile', description: 'Icons as Vue components', package: 'unplugin-icons', dev: true },
      { id: 'vee-validate', name: 'VeeValidate', icon: 'i-lucide-shield-check', description: 'Form validation', package: 'vee-validate' },
    ],
  },
  {
    id: 'vite-react',
    name: 'Vite + React',
    icon: 'i-simple-icons-vite',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['create', 'vite', '{name}', '--template', 'react-ts'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'preview'],
    },
    identifiers: ['vite.config.ts', 'vite.config.js'],
    description: 'Fast React development with Vite',
    modules: [
      { id: 'react-router', name: 'React Router', icon: 'i-lucide-route', description: 'Client-side routing', package: 'react-router-dom', recommended: true },
      { id: 'zustand', name: 'Zustand', icon: 'i-lucide-database', description: 'Lightweight state management', package: 'zustand', recommended: true },
      { id: 'react-query', name: 'TanStack Query', icon: 'i-lucide-refresh-cw', description: 'Async state management', package: '@tanstack/react-query' },
      { id: 'tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: 'tailwindcss', dev: true },
      { id: 'react-hook-form', name: 'React Hook Form', icon: 'i-lucide-shield-check', description: 'Performant form handling', package: 'react-hook-form' },
      { id: 'framer-motion', name: 'Framer Motion', icon: 'i-lucide-move', description: 'Animation library', package: 'framer-motion' },
    ],
  },
  {
    id: 'astro',
    name: 'Astro',
    icon: 'i-simple-icons-astro',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['create', 'astro@latest', '{name}', '--', '--template', 'minimal', '--no-install', '-y'],
      skipGit: ['--no-git'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'preview'],
    },
    identifiers: ['astro.config.mjs', 'astro.config.ts'],
    description: 'Content-focused web framework',
    modules: [
      { id: 'astro-tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: '@astrojs/tailwind', recommended: true },
      { id: 'astro-react', name: 'React', icon: 'i-simple-icons-react', description: 'Use React components', package: '@astrojs/react' },
      { id: 'astro-vue', name: 'Vue', icon: 'i-simple-icons-vue-dot-js', description: 'Use Vue components', package: '@astrojs/vue' },
      { id: 'astro-svelte', name: 'Svelte', icon: 'i-simple-icons-svelte', description: 'Use Svelte components', package: '@astrojs/svelte' },
      { id: 'astro-mdx', name: 'MDX', icon: 'i-lucide-file-text', description: 'MDX support for content', package: '@astrojs/mdx' },
      { id: 'astro-sitemap', name: 'Sitemap', icon: 'i-lucide-map', description: 'Auto-generate sitemap', package: '@astrojs/sitemap' },
      { id: 'astro-image', name: 'Image', icon: 'i-lucide-image', description: 'Optimized image handling', package: '@astrojs/image' },
    ],
  },
  {
    id: 'svelte',
    name: 'SvelteKit',
    icon: 'i-simple-icons-svelte',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'sv', 'create', '{name}', '--template', 'minimal', '--no-add-ons', '--no-install', '--types', 'ts'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'preview'],
    },
    identifiers: ['svelte.config.js', 'svelte.config.ts'],
    description: 'Cybernetically enhanced web apps',
    modules: [
      { id: 'svelte-tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: 'tailwindcss', dev: true, recommended: true },
      { id: 'svelte-paraglide', name: 'Paraglide', icon: 'i-lucide-globe', description: 'i18n with compiled messages', package: '@inlang/paraglide-sveltekit' },
      { id: 'svelte-lucia', name: 'Lucia', icon: 'i-lucide-lock', description: 'Auth library for SvelteKit', package: 'lucia' },
      { id: 'svelte-superforms', name: 'Superforms', icon: 'i-lucide-shield-check', description: 'Enhanced form handling', package: 'sveltekit-superforms' },
      { id: 'svelte-mdsvex', name: 'mdsvex', icon: 'i-lucide-file-text', description: 'Markdown in Svelte', package: 'mdsvex', dev: true },
    ],
  },
  {
    id: 'angular',
    name: 'Angular',
    icon: 'i-simple-icons-angular',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', '@angular/cli', 'new', '{name}', '--skip-install', '--package-manager=bun'],
      initsGit: true,
      skipGit: ['--skip-git'],
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'start'],
      build: ['bun', 'run', 'build'],
      test: ['bun', 'run', 'test'],
    },
    identifiers: ['angular.json'],
    description: 'Platform for building web applications',
    modules: [
      { id: 'ng-material', name: 'Angular Material', icon: 'i-lucide-palette', description: 'Material Design components', package: '@angular/material', recommended: true },
      { id: 'ng-cdk', name: 'Angular CDK', icon: 'i-lucide-layers', description: 'Component Dev Kit primitives', package: '@angular/cdk' },
      { id: 'ngrx-store', name: 'NgRx Store', icon: 'i-lucide-database', description: 'Reactive state management', package: '@ngrx/store' },
      { id: 'ng-tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: 'tailwindcss', dev: true },
      { id: 'ng-transloco', name: 'Transloco', icon: 'i-lucide-globe', description: 'Internationalization', package: '@jsverse/transloco' },
    ],
  },
  {
    id: 'solid-start',
    name: 'SolidStart',
    icon: 'i-simple-icons-solid',
    category: 'frontend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-solid', '{name}', '--solidstart', '-t', 'basic', '--ts'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'start'],
    },
    identifiers: ['app.config.ts', 'solid'],
    description: 'Fine-grained reactive web framework',
    modules: [
      { id: 'solid-tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: 'tailwindcss', dev: true, recommended: true },
      { id: 'solid-query', name: 'TanStack Query', icon: 'i-lucide-refresh-cw', description: 'Async state management', package: '@tanstack/solid-query' },
      { id: 'solid-primitives', name: 'Solid Primitives', icon: 'i-lucide-box', description: 'Utility primitives', package: '@solid-primitives/storage' },
      { id: 'kobalte', name: 'Kobalte', icon: 'i-lucide-palette', description: 'Accessible UI components', package: '@kobalte/core' },
    ],
  },

  // ============================================
  // MOBILE
  // ============================================
  {
    id: 'flutter',
    name: 'Flutter',
    icon: 'i-simple-icons-flutter',
    category: 'mobile',
    packageManager: 'flutter',
    requiredTools: [
      { command: 'flutter', name: 'Flutter SDK', installUrl: 'https://docs.flutter.dev/get-started/install', installHint: 'brew install --cask flutter' },
      { command: 'xcodebuild', name: 'Xcode Command Line Tools', installUrl: 'https://developer.apple.com/xcode/', installHint: 'xcode-select --install' },
    ],
    create: {
      cmd: 'flutter',
      args: ['create', '{name}'],
      initsGit: true,
    },
    commands: {
      install: ['flutter', 'pub', 'get'],
      dev: ['flutter', 'run'],
      build: ['flutter', 'build', 'apk'],
    },
    identifiers: ['pubspec.yaml'],
    description: 'Cross-platform mobile framework',
    modules: [
      { id: 'flutter-riverpod', name: 'Riverpod', icon: 'i-lucide-database', description: 'Reactive state management', package: 'flutter_riverpod', recommended: true },
      { id: 'flutter-bloc', name: 'Bloc', icon: 'i-lucide-layers', description: 'BLoC pattern state management', package: 'flutter_bloc' },
      { id: 'go-router', name: 'GoRouter', icon: 'i-lucide-route', description: 'Declarative routing', package: 'go_router', recommended: true },
      { id: 'dio', name: 'Dio', icon: 'i-lucide-globe', description: 'HTTP client', package: 'dio' },
      { id: 'freezed', name: 'Freezed', icon: 'i-lucide-snowflake', description: 'Immutable data classes', package: 'freezed', dev: true },
      { id: 'hive', name: 'Hive', icon: 'i-lucide-hard-drive', description: 'Lightweight key-value storage', package: 'hive_flutter' },
      { id: 'flutter-icons', name: 'Lucide Icons', icon: 'i-lucide-smile', description: 'Beautiful icon set', package: 'lucide_icons' },
    ],
  },
  {
    id: 'expo',
    name: 'Expo',
    icon: 'i-simple-icons-expo',
    category: 'mobile',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-expo-app@latest', '{name}', '--template', 'blank-typescript', '--no-install'],
      nonInteractive: ['--yes'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'start'],
      build: ['bun', 'run', 'build'],
    },
    identifiers: ['app.json', 'expo.json'],
    description: 'React Native with Expo',
    modules: [
      { id: 'expo-router', name: 'Expo Router', icon: 'i-lucide-route', description: 'File-based routing', package: 'expo-router', recommended: true },
      { id: 'nativewind', name: 'NativeWind', icon: 'i-simple-icons-tailwindcss', description: 'Tailwind CSS for RN', package: 'nativewind', recommended: true },
      { id: 'expo-image', name: 'Expo Image', icon: 'i-lucide-image', description: 'Optimized image component', package: 'expo-image' },
      { id: 'zustand', name: 'Zustand', icon: 'i-lucide-database', description: 'Lightweight state management', package: 'zustand' },
      { id: 'expo-secure-store', name: 'Secure Store', icon: 'i-lucide-lock', description: 'Encrypted key-value storage', package: 'expo-secure-store' },
      { id: 'react-query', name: 'TanStack Query', icon: 'i-lucide-refresh-cw', description: 'Async state management', package: '@tanstack/react-query' },
    ],
  },
  {
    id: 'rn',
    name: 'React Native',
    icon: 'i-simple-icons-react',
    category: 'mobile',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', '@react-native-community/cli', 'init', '{name}', '--skip-install', '--pm', 'bun'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'start'],
      build: ['bun', 'run', 'build'],
    },
    identifiers: ['metro.config.js', 'react-native.config.js'],
    description: 'Native mobile apps with React',
    modules: [
      { id: 'rn-navigation', name: 'React Navigation', icon: 'i-lucide-route', description: 'Screen navigation', package: '@react-navigation/native', recommended: true },
      { id: 'nativewind', name: 'NativeWind', icon: 'i-simple-icons-tailwindcss', description: 'Tailwind CSS for RN', package: 'nativewind' },
      { id: 'rn-reanimated', name: 'Reanimated', icon: 'i-lucide-move', description: 'Smooth animations', package: 'react-native-reanimated', recommended: true },
      { id: 'zustand', name: 'Zustand', icon: 'i-lucide-database', description: 'Lightweight state management', package: 'zustand' },
      { id: 'mmkv', name: 'MMKV', icon: 'i-lucide-hard-drive', description: 'Fast key-value storage', package: 'react-native-mmkv' },
      { id: 'react-query', name: 'TanStack Query', icon: 'i-lucide-refresh-cw', description: 'Async state management', package: '@tanstack/react-query' },
    ],
  },
  {
    id: 'tauri',
    name: 'Tauri',
    icon: 'i-simple-icons-tauri',
    category: 'mobile',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
      { command: 'cargo', name: 'Rust/Cargo', installUrl: 'https://www.rust-lang.org/tools/install', installHint: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-tauri-app', '{name}', '--template', 'vue-ts', '--manager', 'bun', '-y'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'tauri', 'dev'],
      build: ['bun', 'run', 'tauri', 'build'],
    },
    identifiers: ['tauri.conf.json', 'src-tauri'],
    description: 'Desktop apps with web tech',
    modules: [
      { id: 'tauri-store', name: 'Tauri Store', icon: 'i-lucide-hard-drive', description: 'Persistent key-value storage', package: '@tauri-apps/plugin-store', recommended: true },
      { id: 'tauri-fs', name: 'File System', icon: 'i-lucide-folder', description: 'File system access', package: '@tauri-apps/plugin-fs' },
      { id: 'tauri-dialog', name: 'Dialog', icon: 'i-lucide-message-square', description: 'Native dialogs', package: '@tauri-apps/plugin-dialog' },
      { id: 'tauri-shell', name: 'Shell', icon: 'i-lucide-terminal', description: 'Run shell commands', package: '@tauri-apps/plugin-shell' },
      { id: 'tauri-updater', name: 'Updater', icon: 'i-lucide-download', description: 'Auto-update support', package: '@tauri-apps/plugin-updater' },
    ],
  },

  // ============================================
  // BACKEND
  // ============================================
  {
    id: 'laravel',
    name: 'Laravel',
    icon: 'i-simple-icons-laravel',
    category: 'backend',
    packageManager: 'composer',
    requiredTools: [
      { command: 'composer', name: 'Composer', installUrl: 'https://getcomposer.org/download/', installHint: 'brew install composer' },
      { command: 'php', name: 'PHP', installUrl: 'https://www.php.net/downloads', installHint: 'brew install php' },
    ],
    create: {
      cmd: 'composer',
      args: ['create-project', 'laravel/laravel', '{name}'],
      initsGit: true,
    },
    commands: {
      install: ['composer', 'install'],
      dev: ['php', 'artisan', 'serve'],
      build: ['php', 'artisan', 'optimize'],
    },
    identifiers: ['artisan', 'composer.json'],
    description: 'PHP web application framework',
    modules: [
      { id: 'laravel-breeze', name: 'Breeze', icon: 'i-lucide-lock', description: 'Auth scaffolding', package: 'laravel/breeze', recommended: true },
      { id: 'laravel-sanctum', name: 'Sanctum', icon: 'i-lucide-shield', description: 'API token auth', package: 'laravel/sanctum' },
      { id: 'laravel-livewire', name: 'Livewire', icon: 'i-lucide-zap', description: 'Reactive UI without JS', package: 'livewire/livewire' },
      { id: 'laravel-telescope', name: 'Telescope', icon: 'i-lucide-search', description: 'Debug assistant', package: 'laravel/telescope', dev: true },
      { id: 'laravel-horizon', name: 'Horizon', icon: 'i-lucide-bar-chart', description: 'Queue dashboard', package: 'laravel/horizon' },
      { id: 'laravel-socialite', name: 'Socialite', icon: 'i-lucide-users', description: 'OAuth social login', package: 'laravel/socialite' },
    ],
  },
  {
    id: 'rails',
    name: 'Rails',
    icon: 'i-simple-icons-rubyonrails',
    category: 'backend',
    packageManager: 'none',
    requiredTools: [
      { command: 'rails', name: 'Rails', installUrl: 'https://guides.rubyonrails.org/getting_started.html', installHint: 'gem install rails' },
      { command: 'ruby', name: 'Ruby', installUrl: 'https://www.ruby-lang.org/en/downloads/', installHint: 'brew install ruby' },
    ],
    create: {
      cmd: 'rails',
      args: ['new', '{name}', '--skip-bundle'],
      skipGit: ['--skip-git'],
      initsGit: true,
    },
    commands: {
      install: ['bundle', 'install'],
      dev: ['rails', 'server'],
      build: ['rails', 'assets:precompile'],
    },
    identifiers: ['Gemfile', 'config/routes.rb'],
    description: 'Ruby web application framework',
    modules: [
      { id: 'rails-devise', name: 'Devise', icon: 'i-lucide-lock', description: 'Flexible authentication', package: 'devise', recommended: true },
      { id: 'rails-sidekiq', name: 'Sidekiq', icon: 'i-lucide-layers', description: 'Background job processing', package: 'sidekiq' },
      { id: 'rails-pundit', name: 'Pundit', icon: 'i-lucide-shield', description: 'Authorization policies', package: 'pundit' },
      { id: 'rails-stimulus', name: 'Stimulus', icon: 'i-lucide-zap', description: 'Modest JS framework', package: 'stimulus-rails' },
      { id: 'rails-turbo', name: 'Turbo', icon: 'i-lucide-rocket', description: 'Speed up page navigation', package: 'turbo-rails', recommended: true },
      { id: 'rails-pg-search', name: 'PgSearch', icon: 'i-lucide-search', description: 'Full-text search', package: 'pg_search' },
    ],
  },
  {
    id: 'fastapi',
    name: 'FastAPI',
    icon: 'i-simple-icons-fastapi',
    category: 'backend',
    packageManager: 'pip',
    requiredTools: [
      { command: 'python3', name: 'Python 3', installUrl: 'https://www.python.org/downloads/', installHint: 'brew install python' },
    ],
    create: {
      cmd: 'mkdir',
      args: ['-p', '{name}'],
      initsGit: false,
    },
    commands: {
      install: ['pip', 'install', '-r', 'requirements.txt'],
      dev: ['uvicorn', 'main:app', '--reload'],
      build: ['pip', 'freeze', '>', 'requirements.txt'],
    },
    identifiers: ['main.py', 'requirements.txt'],
    description: 'Modern Python web framework',
    modules: [
      { id: 'sqlalchemy', name: 'SQLAlchemy', icon: 'i-lucide-database', description: 'SQL toolkit & ORM', package: 'sqlalchemy', recommended: true },
      { id: 'pydantic', name: 'Pydantic', icon: 'i-lucide-shield-check', description: 'Data validation (included)', package: 'pydantic-settings' },
      { id: 'alembic', name: 'Alembic', icon: 'i-lucide-git-branch', description: 'Database migrations', package: 'alembic' },
      { id: 'celery', name: 'Celery', icon: 'i-lucide-layers', description: 'Task queue', package: 'celery' },
      { id: 'httpx', name: 'HTTPX', icon: 'i-lucide-globe', description: 'Async HTTP client', package: 'httpx' },
      { id: 'pytest', name: 'Pytest', icon: 'i-lucide-check-circle', description: 'Testing framework', package: 'pytest', dev: true },
    ],
  },
  {
    id: 'express',
    name: 'Express',
    icon: 'i-simple-icons-express',
    category: 'backend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'express-generator', '{name}', '--no-view'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'start'],
      build: ['bun', 'run', 'build'],
    },
    identifiers: ['app.js', 'express'],
    description: 'Minimal Node.js web framework',
    modules: [
      { id: 'cors', name: 'CORS', icon: 'i-lucide-shield', description: 'Cross-origin resource sharing', package: 'cors', recommended: true },
      { id: 'helmet', name: 'Helmet', icon: 'i-lucide-shield-check', description: 'Security HTTP headers', package: 'helmet', recommended: true },
      { id: 'prisma', name: 'Prisma', icon: 'i-simple-icons-prisma', description: 'Type-safe database ORM', package: 'prisma', dev: true },
      { id: 'zod', name: 'Zod', icon: 'i-lucide-check-circle', description: 'Schema validation', package: 'zod' },
      { id: 'morgan', name: 'Morgan', icon: 'i-lucide-file-text', description: 'HTTP request logger', package: 'morgan' },
      { id: 'dotenv', name: 'Dotenv', icon: 'i-lucide-key', description: 'Environment variables', package: 'dotenv' },
    ],
  },
  {
    id: 'nestjs',
    name: 'NestJS',
    icon: 'i-simple-icons-nestjs',
    category: 'backend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', '@nestjs/cli', 'new', '{name}', '--package-manager', 'bun', '--skip-install'],
      skipGit: ['--skip-git'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'start:dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'start:prod'],
    },
    identifiers: ['nest-cli.json'],
    description: 'Progressive Node.js framework',
    modules: [
      { id: 'nest-prisma', name: 'Prisma', icon: 'i-simple-icons-prisma', description: 'Type-safe database ORM', package: 'prisma', dev: true, recommended: true },
      { id: 'nest-swagger', name: 'Swagger', icon: 'i-lucide-file-text', description: 'API documentation', package: '@nestjs/swagger', recommended: true },
      { id: 'nest-passport', name: 'Passport', icon: 'i-lucide-lock', description: 'Authentication', package: '@nestjs/passport' },
      { id: 'nest-jwt', name: 'JWT', icon: 'i-lucide-key', description: 'JWT auth strategy', package: '@nestjs/jwt' },
      { id: 'nest-config', name: 'Config', icon: 'i-lucide-settings', description: 'Configuration module', package: '@nestjs/config' },
      { id: 'nest-bull', name: 'Bull', icon: 'i-lucide-layers', description: 'Queue processing', package: '@nestjs/bull' },
    ],
  },
  {
    id: 'hono',
    name: 'Hono',
    icon: 'i-simple-icons-hono',
    category: 'backend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-hono', '{name}', '-t', 'bun', '-p', 'bun', '--install'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
    },
    identifiers: ['hono'],
    description: 'Ultrafast web framework',
    modules: [
      { id: 'hono-zod', name: 'Zod OpenAPI', icon: 'i-lucide-shield-check', description: 'Validation + OpenAPI docs', package: '@hono/zod-openapi', recommended: true },
      { id: 'hono-jwt', name: 'JWT Auth', icon: 'i-lucide-key', description: 'JWT authentication', package: '@hono/jwt' },
      { id: 'hono-cors', name: 'CORS', icon: 'i-lucide-shield', description: 'Cross-origin resource sharing', package: '@hono/cors' },
      { id: 'drizzle', name: 'Drizzle ORM', icon: 'i-lucide-database', description: 'Type-safe SQL ORM', package: 'drizzle-orm', recommended: true },
    ],
  },
  {
    id: 'django',
    name: 'Django',
    icon: 'i-simple-icons-django',
    category: 'backend',
    packageManager: 'pip',
    requiredTools: [
      { command: 'python3', name: 'Python 3', installUrl: 'https://www.python.org/downloads/', installHint: 'brew install python' },
      { command: 'django-admin', name: 'Django', installUrl: 'https://docs.djangoproject.com/en/stable/intro/install/', installHint: 'pip install django' },
    ],
    create: {
      cmd: 'django-admin',
      args: ['startproject', '{name}'],
      initsGit: false,
    },
    commands: {
      dev: ['python3', 'manage.py', 'runserver'],
      build: ['python3', 'manage.py', 'collectstatic', '--noinput'],
      test: ['python3', 'manage.py', 'test'],
    },
    identifiers: ['manage.py', 'settings.py'],
    description: 'Python web framework for perfectionists',
    modules: [
      { id: 'drf', name: 'REST Framework', icon: 'i-lucide-globe', description: 'Django REST Framework', package: 'djangorestframework', recommended: true },
      { id: 'django-cors', name: 'CORS Headers', icon: 'i-lucide-shield', description: 'Cross-origin handling', package: 'django-cors-headers', recommended: true },
      { id: 'celery', name: 'Celery', icon: 'i-lucide-layers', description: 'Task queue', package: 'celery' },
      { id: 'django-allauth', name: 'Allauth', icon: 'i-lucide-lock', description: 'Authentication & social login', package: 'django-allauth' },
      { id: 'django-filter', name: 'Django Filter', icon: 'i-lucide-filter', description: 'Queryset filtering', package: 'django-filter' },
      { id: 'django-debug', name: 'Debug Toolbar', icon: 'i-lucide-bug', description: 'Debug panel', package: 'django-debug-toolbar', dev: true },
    ],
  },
  {
    id: 'elysia',
    name: 'Elysia',
    icon: 'i-lucide-zap',
    category: 'backend',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['create', 'elysia', '{name}'],
      initsGit: false,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'start'],
    },
    identifiers: ['elysia'],
    description: 'Ergonomic framework for Bun',
    modules: [
      { id: 'elysia-swagger', name: 'Swagger', icon: 'i-lucide-file-text', description: 'API documentation', package: '@elysiajs/swagger', recommended: true },
      { id: 'elysia-jwt', name: 'JWT', icon: 'i-lucide-key', description: 'JWT authentication', package: '@elysiajs/jwt' },
      { id: 'elysia-cors', name: 'CORS', icon: 'i-lucide-shield', description: 'Cross-origin resource sharing', package: '@elysiajs/cors', recommended: true },
      { id: 'elysia-bearer', name: 'Bearer', icon: 'i-lucide-lock', description: 'Bearer token auth', package: '@elysiajs/bearer' },
      { id: 'drizzle', name: 'Drizzle ORM', icon: 'i-lucide-database', description: 'Type-safe SQL ORM', package: 'drizzle-orm' },
    ],
  },

  // ============================================
  // FULLSTACK
  // ============================================
  {
    id: 't3',
    name: 'T3 Stack',
    icon: 'i-lucide-layers',
    category: 'fullstack',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-t3-app@latest', '{name}', '--CI'],
      skipGit: ['--noGit'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'start'],
    },
    identifiers: ['create-t3-app'],
    description: 'Next.js + tRPC + Prisma + Tailwind',
    modules: [
      { id: 't3-next-auth', name: 'NextAuth.js', icon: 'i-lucide-lock', description: 'Authentication', package: 'next-auth', recommended: true },
      { id: 't3-drizzle', name: 'Drizzle ORM', icon: 'i-lucide-database', description: 'Type-safe SQL (alt to Prisma)', package: 'drizzle-orm' },
      { id: 't3-uploadthing', name: 'UploadThing', icon: 'i-lucide-upload', description: 'File uploads', package: 'uploadthing' },
      { id: 't3-zustand', name: 'Zustand', icon: 'i-lucide-layers', description: 'Client state management', package: 'zustand' },
    ],
  },
  {
    id: 'react-router',
    name: 'React Router',
    icon: 'i-simple-icons-reactrouter',
    category: 'fullstack',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-react-router@latest', '{name}', '--no-install', '-y'],
      skipGit: ['--no-git-init'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'dev'],
      build: ['bun', 'run', 'build'],
      start: ['bun', 'run', 'start'],
    },
    identifiers: ['react-router.config.ts', 'react-router.config.js'],
    description: 'Full stack React framework (formerly Remix)',
    modules: [
      { id: 'rr-tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: 'tailwindcss', dev: true, recommended: true },
      { id: 'rr-prisma', name: 'Prisma', icon: 'i-simple-icons-prisma', description: 'Type-safe database ORM', package: 'prisma', dev: true },
      { id: 'rr-zod', name: 'Zod', icon: 'i-lucide-shield-check', description: 'Schema validation', package: 'zod' },
      { id: 'rr-conform', name: 'Conform', icon: 'i-lucide-check-circle', description: 'Progressive form handling', package: '@conform-to/react' },
    ],
  },
  {
    id: 'redwood',
    name: 'RedwoodJS',
    icon: 'i-lucide-layers',
    category: 'fullstack',
    packageManager: 'bun',
    requiredTools: [
      { command: 'bun', name: 'Bun', installUrl: 'https://bun.sh', installHint: 'curl -fsSL https://bun.sh/install | bash' },
    ],
    create: {
      cmd: 'bun',
      args: ['x', 'create-redwood-app', '{name}', '-y', '--no-check'],
      initsGit: true,
    },
    commands: {
      install: ['bun', 'install'],
      dev: ['bun', 'run', 'rw', 'dev'],
      build: ['bun', 'run', 'rw', 'build'],
    },
    identifiers: ['redwood.toml'],
    description: 'Full-stack JS/TS framework',
    modules: [
      { id: 'rw-auth', name: 'Auth (dbAuth)', icon: 'i-lucide-lock', description: 'Built-in authentication', package: '@redwoodjs/auth-dbauth-setup', recommended: true },
      { id: 'rw-tailwind', name: 'Tailwind CSS', icon: 'i-simple-icons-tailwindcss', description: 'Utility-first CSS', package: 'tailwindcss', dev: true },
      { id: 'rw-storybook', name: 'Storybook', icon: 'i-lucide-book-open', description: 'Component development', package: 'storybook', dev: true },
    ],
  },
  {
    id: 'duxt',
    name: 'Duxt',
    icon: 'i-lucide-hexagon',
    category: 'fullstack',
    packageManager: 'none',
    requiredTools: [
      { command: 'duxt', name: 'Duxt CLI', installUrl: 'https://duxt.dev', installHint: 'dart pub global activate duxt' },
      { command: 'dart', name: 'Dart SDK', installUrl: 'https://dart.dev/get-dart', installHint: 'brew install dart' },
    ],
    create: {
      cmd: 'duxt',
      args: ['create', '{name}', '--template=server'],
      initsGit: false,
    },
    commands: {
      install: ['dart', 'pub', 'get'],
      dev: ['duxt', 'dev'],
      build: ['duxt', 'build'],
    },
    identifiers: ['duxt.yaml', 'pubspec.yaml'],
    description: 'Dart full-stack framework with ORM',
    modules: [
      {
        id: 'duxt-ui',
        name: 'Duxt UI',
        icon: 'i-lucide-palette',
        description: 'Styled UI components (Button, Card, etc.)',
        package: 'duxt_ui',
        recommended: true,
      },
      {
        id: 'duxt-icons',
        name: 'Duxt Icons',
        icon: 'i-lucide-smile',
        description: '200k+ icons from Iconify',
        package: 'duxt_icons',
        recommended: true,
      },
      {
        id: 'duxt-html',
        name: 'Duxt HTML',
        icon: 'i-lucide-code',
        description: 'Flutter-style HTML components',
        package: 'duxt_html',
        recommended: true,
      },
      {
        id: 'duxt-signals',
        name: 'Duxt Signals',
        icon: 'i-lucide-radio',
        description: 'Reactive state management & forms',
        package: 'duxt_signals',
      },
      {
        id: 'duxt-orm',
        name: 'Duxt ORM',
        icon: 'i-lucide-database',
        description: 'ActiveRecord-style ORM (Postgres/MySQL/SQLite)',
        package: 'duxt_orm',
      },
      {
        id: 'duxt-content',
        name: 'Content',
        icon: 'i-lucide-file-text',
        description: 'Markdown-based content system',
        package: 'jaspr_content',
      },
    ],
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    icon: 'i-simple-icons-phoenixframework',
    category: 'fullstack',
    packageManager: 'none',
    requiredTools: [
      { command: 'elixir', name: 'Elixir', installUrl: 'https://elixir-lang.org/install.html', installHint: 'brew install elixir' },
      { command: 'mix', name: 'Mix', installUrl: 'https://elixir-lang.org/install.html', installHint: 'Included with Elixir' },
    ],
    create: {
      cmd: 'mix',
      args: ['phx.new', '{name}', '--no-install'],
      initsGit: false,
    },
    commands: {
      install: ['mix', 'deps.get'],
      dev: ['mix', 'phx.server'],
      build: ['mix', 'release'],
      test: ['mix', 'test'],
    },
    identifiers: ['mix.exs', 'config/config.exs'],
    description: 'Productive Elixir web framework',
    modules: [
      { id: 'phx-liveview', name: 'LiveView', icon: 'i-lucide-zap', description: 'Real-time server-rendered UI', package: 'phoenix_live_view', recommended: true },
      { id: 'phx-swoosh', name: 'Swoosh', icon: 'i-lucide-mail', description: 'Email library', package: 'swoosh' },
      { id: 'phx-oban', name: 'Oban', icon: 'i-lucide-layers', description: 'Background job processing', package: 'oban' },
      { id: 'phx-guardian', name: 'Guardian', icon: 'i-lucide-lock', description: 'JWT authentication', package: 'guardian' },
      { id: 'phx-absinthe', name: 'Absinthe', icon: 'i-lucide-git-branch', description: 'GraphQL toolkit', package: 'absinthe' },
    ],
  },
  {
    id: 'go-stdlib',
    name: 'Go (stdlib)',
    icon: 'i-simple-icons-go',
    category: 'backend',
    packageManager: 'none',
    requiredTools: [
      { command: 'go', name: 'Go', installUrl: 'https://go.dev/dl/', installHint: 'brew install go' },
    ],
    create: {
      cmd: 'mkdir',
      args: ['-p', '{name}'],
      initsGit: false,
    },
    commands: {
      dev: ['go', 'run', '.'],
      build: ['go', 'build', '-o', 'server', '.'],
      test: ['go', 'test', './...'],
    },
    identifiers: ['go.mod', 'main.go'],
    description: 'Go project with standard library',
    modules: [
      { id: 'go-chi', name: 'Chi', icon: 'i-lucide-route', description: 'Lightweight HTTP router', package: 'github.com/go-chi/chi/v5', recommended: true },
      { id: 'go-sqlc', name: 'sqlc', icon: 'i-lucide-database', description: 'Type-safe SQL generation', package: 'github.com/sqlc-dev/sqlc' },
      { id: 'go-slog', name: 'slog', icon: 'i-lucide-file-text', description: 'Structured logging (stdlib)', package: 'log/slog' },
      { id: 'go-validator', name: 'Validator', icon: 'i-lucide-shield-check', description: 'Struct validation', package: 'github.com/go-playground/validator/v10' },
      { id: 'go-godotenv', name: 'godotenv', icon: 'i-lucide-key', description: 'Load .env files', package: 'github.com/joho/godotenv' },
    ],
  },
]

// Helper to get templates by category
export function getTemplatesByCategory(category: TemplateConfig['category']): TemplateConfig[] {
  return templates.filter(t => t.category === category)
}

// Helper to get template by id
export function getTemplate(id: string): TemplateConfig | undefined {
  return templates.find(t => t.id === id)
}

// Helper to detect template from project files
export function detectTemplate(files: string[]): TemplateConfig | undefined {
  for (const template of templates) {
    if (template.identifiers?.some(id => files.includes(id))) {
      return template
    }
  }
  return undefined
}

// Sanitize project name based on template requirements
// Accepts a TemplateConfig directly or a template ID for convenience
export function sanitizeProjectName(name: string, templateOrId: string | TemplateConfig): string {
  const template = typeof templateOrId === 'string' ? getTemplate(templateOrId) : templateOrId

  // Flutter/Dart requires snake_case
  if (template?.packageManager === 'flutter' || (template?.packageManager === 'none' && template?.requiredTools?.some(t => t.command === 'dart'))) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  }

  // React Native requires PascalCase (alphanumeric only)
  if (template?.id === 'rn') {
    return name
      .replace(/[^a-zA-Z0-9\s-_]/g, '')
      .split(/[\s\-_]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
  }

  // Default: kebab-case for most JS/web projects
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Build create command with all args
// Accepts a TemplateConfig directly or a template ID for convenience
export function buildCreateCommand(
  templateOrId: string | TemplateConfig,
  projectName: string,
  options: { initGit?: boolean } = {}
): { cmd: string; args: string[] } | null {
  const template = typeof templateOrId === 'string' ? getTemplate(templateOrId) : templateOrId
  if (!template) return null

  const name = sanitizeProjectName(projectName, template)
  const args = template.create.args.map(arg => arg.replace('{name}', name))

  // Add non-interactive flags
  if (template.create.nonInteractive) {
    args.push(...template.create.nonInteractive)
  }

  // Add skip git flags if user unchecked git and template inits git by default
  if (!options.initGit && template.create.initsGit && template.create.skipGit) {
    args.push(...template.create.skipGit)
  }

  return { cmd: template.create.cmd, args }
}

// Construct project marker - added to .construct/project.json
export interface ConstructProjectConfig {
  version: 1
  template?: string
  created: string
  commands?: TemplateConfig['commands']
}

// Generate .construct/project.json content
// Accepts a TemplateConfig directly or a template ID for convenience
export function generateConstructConfig(templateOrId?: string | TemplateConfig): ConstructProjectConfig {
  const template = typeof templateOrId === 'string' ? getTemplate(templateOrId) : templateOrId
  return {
    version: 1,
    template: template?.id,
    created: new Date().toISOString(),
    commands: template?.commands,
  }
}

// Get required tools for a template
// Accepts a TemplateConfig directly or a template ID for convenience
export function getRequiredTools(templateOrId: string | TemplateConfig): RequiredTool[] {
  const template = typeof templateOrId === 'string' ? getTemplate(templateOrId) : templateOrId
  return template?.requiredTools || []
}

// Check result for a missing tool
export interface MissingToolError {
  tool: RequiredTool
  message: string
}

// Format a user-friendly error message for missing tools
export function formatMissingToolsError(missingTools: RequiredTool[]): string {
  if (missingTools.length === 0) return ''

  const lines = missingTools.map(tool => {
    let msg = `• ${tool.name} is not installed`
    if (tool.installHint) {
      msg += `\n  Install: ${tool.installHint}`
    }
    if (tool.installUrl) {
      msg += `\n  More info: ${tool.installUrl}`
    }
    return msg
  })

  return `Required tools not found:\n\n${lines.join('\n\n')}`
}

// Common error patterns and their user-friendly messages
const errorPatterns: Array<{ pattern: RegExp; title: string; hint: string }> = [
  {
    pattern: /xcodebuild.*not.*found|unable to find utility "xcodebuild"/i,
    title: 'Xcode Command Line Tools Required',
    hint: 'Run: xcode-select --install',
  },
  {
    pattern: /xcrun.*error|xcrun: error/i,
    title: 'Xcode Tools Not Configured',
    hint: 'Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
  },
  {
    pattern: /flutter.*not found|command not found.*flutter/i,
    title: 'Flutter SDK Not Found',
    hint: 'Install Flutter: brew install --cask flutter',
  },
  {
    pattern: /bun.*not found|command not found.*bun/i,
    title: 'Bun Not Found',
    hint: 'Install Bun: curl -fsSL https://bun.sh/install | bash',
  },
  {
    pattern: /npm.*not found|command not found.*npm/i,
    title: 'Node.js/npm Not Found',
    hint: 'Install Node.js: brew install node',
  },
  {
    pattern: /composer.*not found|command not found.*composer/i,
    title: 'Composer Not Found',
    hint: 'Install Composer: brew install composer',
  },
  {
    pattern: /rails.*not found|command not found.*rails/i,
    title: 'Rails Not Found',
    hint: 'Install Rails: gem install rails',
  },
  {
    pattern: /cargo.*not found|command not found.*cargo/i,
    title: 'Rust/Cargo Not Found',
    hint: 'Install Rust: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
  },
  {
    pattern: /EACCES|permission denied/i,
    title: 'Permission Denied',
    hint: 'Check folder permissions or try a different location',
  },
  {
    pattern: /ENOENT|no such file or directory/i,
    title: 'File or Directory Not Found',
    hint: 'The target path may not exist or is inaccessible',
  },
  {
    pattern: /EEXIST|already exists/i,
    title: 'Already Exists',
    hint: 'A project with this name already exists. Choose a different name.',
  },
  {
    pattern: /network|ETIMEDOUT|ECONNREFUSED/i,
    title: 'Network Error',
    hint: 'Check your internet connection and try again',
  },
]

// Parse error output and return user-friendly message
export function parseCommandError(errorOutput: string): { title: string; hint: string } | null {
  for (const { pattern, title, hint } of errorPatterns) {
    if (pattern.test(errorOutput)) {
      return { title, hint }
    }
  }
  return null
}
