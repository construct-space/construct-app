import { ref } from 'vue'

/**
 * useBuilderPreview — one-click dev server + in-app browser preview for
 * Builder projects.
 *
 * How it works:
 *   1. Classify the project by reading `package.json` and the project
 *      root. Three classes we currently handle:
 *        - dev-server: there's a `scripts.dev` we can run
 *        - static:     there's an `index.html` at the project root
 *        - unknown:    neither — the button stays disabled
 *   2. Spawn the corresponding process via @tauri-apps/plugin-shell.
 *      Keep the Child handle so we can kill it later.
 *   3. Stream the child's stdout and regex the first
 *      `http://localhost:<port>` we see. That URL is what the framework
 *      actually bound to, regardless of whatever port we *guessed*.
 *   4. Open the URL in the in-app browser window
 *      (openWindow({ type: 'browser', url })) — the browser window type
 *      already allows localhost per openWindow.validateSpec.
 *
 * Intentionally small. Port detection is stdout-driven — we don't try
 * to predict what framework picks which port, because users override
 * ports in vite.config / next.config constantly and static guesses go
 * stale. The tradeoff is ~1s between "process spawned" and "URL
 * detected", but that's still faster than getting a wrong-port guess
 * opened and having to retry.
 */

export type ProjectKind = 'dev-server' | 'static' | 'go-server' | 'python-server' | 'rust-server' | 'unknown'

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface ClassifyResult {
  kind: ProjectKind
  // Script name (e.g. 'dev') the project uses to start the dev server.
  // Only set when kind === 'dev-server'.
  devScript?: string
  // Extra args to pass to the interpreter/runner (e.g. ['runserver'] for Django).
  extraArgs?: string[]
  // Package manager we'll invoke. Picked by lockfile presence.
  packageManager?: 'bun' | 'npm' | 'pnpm' | 'yarn'
  // Non-authoritative hint for which port the dev server will bind to,
  // used only as a safety net if stdout parsing never yields a URL
  // (e.g. some frameworks don't print the localhost line). The real
  // URL still comes from stdout when available.
  fallbackPort?: number
  // Resolved path we should spawn from. May differ from the original
  // projectPath when we detected the runnable app in a subdirectory
  // (e.g. project/code/package.json).
  cwd?: string
}

// Subdirs to ignore when scanning for a subproject root — non-source
// or tooling-owned. node_modules is the obvious one; the rest prevent
// us from mistaking a build cache or git worktree for the app.
const IGNORED_SUBDIRS = new Set([
  'node_modules', '.git', '.construct', '.vscode', '.idea',
  'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.cache',
  'docs', 'test', 'tests', '__tests__', 'coverage',
])

// Common names users give the runnable app when the repo root carries
// docs / tooling / multiple projects. First-match wins, so order
// matters — app code names first, then generic catch-alls.
const PREFERRED_SUBDIR_NAMES = [
  'code', 'app', 'web', 'frontend', 'client', 'ui',
  'site', 'project', 'src',
]

// Framework name tokens that indicate an HTTP server is present. Used to
// gate `*-server` classification so CLI/library projects don't get spawned
// into a preview that will never bind a port.
const PYTHON_SERVER_FRAMEWORKS = ['flask', 'django', 'fastapi', 'starlette', 'uvicorn', 'aiohttp', 'bottle', 'tornado', 'sanic', 'quart']
const RUST_SERVER_FRAMEWORKS = ['axum', 'actix-web', 'rocket', 'warp', 'hyper', 'tide', 'poem', 'salvo']
const GO_SERVER_IMPORTS = ['net/http', 'gin-gonic/gin', 'labstack/echo', 'gofiber/fiber', 'go-chi/chi', 'gorilla/mux']

// Match any http URL pointing at localhost / 127.0.0.1. Frameworks
// print these in a handful of formats ("Local: http://localhost:5173/",
// "- Local:   http://localhost:5173", "ready on http://127.0.0.1:3000"),
// all of which this catches.
const LOCAL_URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/\S*)?)/i

async function pickPackageManager(projectPath: string): Promise<'bun' | 'npm' | 'pnpm' | 'yarn'> {
  const { exists } = await import('@tauri-apps/plugin-fs')
  if (await exists(`${projectPath}/bun.lock`)) return 'bun'
  if (await exists(`${projectPath}/bun.lockb`)) return 'bun'
  if (await exists(`${projectPath}/pnpm-lock.yaml`)) return 'pnpm'
  if (await exists(`${projectPath}/yarn.lock`)) return 'yarn'
  if (await exists(`${projectPath}/package-lock.json`)) return 'npm'
  // No lockfile: default to bun since that's Construct's house preference.
  return 'bun'
}

function guessPortFromScript(devScript: string): number | undefined {
  // Look for explicit --port N or -p N in the command string. Matches
  // `--port 8080`, `--port=8080`, `-p 3000`. Not exhaustive, just catches
  // the common cases where a repo overrides the framework default.
  const m = devScript.match(/(?:--port[= ]|(?:^|\s)-p[= ])(\d{2,5})/)
  if (m) return parseInt(m[1]!, 10)
  return undefined
}

function guessPortFromStack(pkg: PackageJson): number | undefined {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  if ('next' in deps) return 3000
  if ('astro' in deps) return 4321
  if ('vite' in deps) return 5173
  if ('@remix-run/dev' in deps) return 3000
  if ('@sveltejs/kit' in deps) return 5173
  if ('nuxt' in deps) return 3000
  return undefined
}

// classifyRoot is the single-directory classifier — no subdir walk, no
// fallback. Kept pure so classify() can call it against both the
// project root and candidate subdirs. Returns 'unknown' when the dir
// lacks any runnable-app signal we recognise.
async function classifyRoot(projectPath: string): Promise<ClassifyResult> {
  const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')

  const pkgPath = `${projectPath}/package.json`
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readTextFile(pkgPath)) as PackageJson
      const scripts = pkg.scripts ?? {}
      // Prefer 'dev' then 'start' — modern frameworks use 'dev' for the
      // local server; 'start' is common in CRA-era and Node CLIs.
      const scriptName = ['dev', 'start', 'serve'].find(s => s in scripts)
      if (scriptName) {
        const scriptCmd = scripts[scriptName]!
        const packageManager = await pickPackageManager(projectPath)
        const fallbackPort = guessPortFromScript(scriptCmd) ?? guessPortFromStack(pkg)
        return { kind: 'dev-server', devScript: scriptName, packageManager, fallbackPort }
      }
    } catch { /* malformed package.json — fall through to static */ }
  }

  if (await exists(`${projectPath}/index.html`)) {
    return { kind: 'static', packageManager: 'bun', fallbackPort: 5173 }
  }

  // Prebuilt static output under a common output dir — preview serves the
  // output directly. Covers SSG projects (Vite SSG, Astro, Gatsby, Hugo,
  // Next export) whose `main.go` / `npm run build` just generated files.
  const STATIC_OUTPUT_DIRS = ['web', 'dist', 'public', 'out', 'build', '_site']
  for (const dir of STATIC_OUTPUT_DIRS) {
    if (await exists(`${projectPath}/${dir}/index.html`)) {
      return {
        kind: 'static',
        packageManager: 'bun',
        fallbackPort: 5173,
        devScript: dir,
      }
    }
  }

  // Go — require a positive HTTP-server signal AND confirm `main.go`
  // actually binds a listener (ListenAndServe / http.Server / framework
  // constructor). Projects whose `main.go` is an SSG build tool referencing
  // net/http only for client fetches would otherwise be misclassified.
  //
  // NOTE: net/http is stdlib so it never appears in go.mod/go.sum.
  // Check main.go source directly for the import, then also check go.mod
  // for third-party framework imports.
  if (await exists(`${projectPath}/go.mod`)) {
    try {
      const goMod = await readTextFile(`${projectPath}/go.mod`).catch(() => '')
      const goSum = await readTextFile(`${projectPath}/go.sum`).catch(() => '')
      const modHaystack = `${goMod}\n${goSum}`.toLowerCase()
      let bindsListener = false
      let hasFramework = GO_SERVER_IMPORTS.filter(f => f !== 'net/http').some(f => modHaystack.includes(f))
      if (await exists(`${projectPath}/main.go`)) {
        const src = await readTextFile(`${projectPath}/main.go`).catch(() => '')
        bindsListener = /ListenAndServe|http\.Server\s*\{|gin\.(New|Default)|echo\.New|fiber\.New|chi\.NewRouter|mux\.NewRouter/.test(src)
        // stdlib net/http: detect via import in source, not go.mod
        if (!hasFramework && /"net\/http"/.test(src)) hasFramework = true
      }
      if (hasFramework && bindsListener) {
        return { kind: 'go-server', fallbackPort: 8080 }
      }
      // Bare `net/http` import without ListenAndServe = likely a client, not
      // a server — skip go-server classification and fall through.
    } catch { /* fall through */ }
  }

  // Python — look for common entry points AND a positive framework signal.
  for (const entry of ['manage.py', 'main.py', 'app.py', 'server.py']) {
    if (!(await exists(`${projectPath}/${entry}`))) continue

    // Django's manage.py needs the `runserver` subcommand explicitly.
    if (entry === 'manage.py') {
      const src = await readTextFile(`${projectPath}/${entry}`).catch(() => '')
      if (/django/i.test(src)) {
        return { kind: 'python-server', devScript: entry, extraArgs: ['runserver'], fallbackPort: 8000 }
      }
      continue
    }

    // Other entry files: require a framework import in the file itself or
    // in pyproject.toml / requirements.txt.
    const [src, pyproject, requirements] = await Promise.all([
      readTextFile(`${projectPath}/${entry}`).catch(() => ''),
      readTextFile(`${projectPath}/pyproject.toml`).catch(() => ''),
      readTextFile(`${projectPath}/requirements.txt`).catch(() => ''),
    ])
    const haystack = `${src}\n${pyproject}\n${requirements}`.toLowerCase()
    if (PYTHON_SERVER_FRAMEWORKS.some(f => haystack.includes(f))) {
      return { kind: 'python-server', devScript: entry, fallbackPort: 8000 }
    }
  }

  // Rust — require a server framework in Cargo.toml dependencies.
  if (await exists(`${projectPath}/Cargo.toml`)) {
    try {
      const cargo = (await readTextFile(`${projectPath}/Cargo.toml`)).toLowerCase()
      if (RUST_SERVER_FRAMEWORKS.some(f => cargo.includes(f))) {
        return { kind: 'rust-server', fallbackPort: 8080 }
      }
    } catch { /* fall through */ }
  }

  return { kind: 'unknown' }
}

// findSubprojectCandidates walks one level down under `root` and
// returns subdirs in preference order — preferred names first (code,
// app, web, …), then alphabetical. node_modules / .git / build
// outputs are skipped. One level is deliberate: deeper scanning hits
// monorepos with dozens of packages and picks arbitrary ones.
async function findSubprojectCandidates(root: string): Promise<string[]> {
  try {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(root)
    const dirs = entries
      .filter(e => e.isDirectory && e.name && !IGNORED_SUBDIRS.has(e.name) && !e.name.startsWith('.'))
      .map(e => e.name as string)
    dirs.sort((a, b) => {
      const ai = PREFERRED_SUBDIR_NAMES.indexOf(a)
      const bi = PREFERRED_SUBDIR_NAMES.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
    return dirs.map(d => `${root}/${d}`)
  } catch {
    return []
  }
}

// classify tries the project root first; if unclassifiable, walks one
// level of subdirs looking for the real app (e.g. google-chat-clone/
// with the Vite app under ./code/). Annotates the result with the cwd
// we should spawn from so start() doesn't re-derive it.
async function classify(projectPath: string): Promise<ClassifyResult> {
  const atRoot = await classifyRoot(projectPath)
  if (atRoot.kind !== 'unknown') {
    return { ...atRoot, cwd: projectPath }
  }

  for (const candidate of await findSubprojectCandidates(projectPath)) {
    const atSub = await classifyRoot(candidate)
    if (atSub.kind !== 'unknown') {
      return { ...atSub, cwd: candidate }
    }
  }

  return { kind: 'unknown' }
}

interface PreviewProcess {
  // Tauri Child — loose typing to avoid pulling @tauri-apps types into
  // the composable's public surface.
  child: { kill: () => Promise<void> }
  url?: string
}

export function useBuilderPreview() {
  const starting = ref(false)
  const running = ref(false)
  const url = ref<string | null>(null)
  const error = ref<string | null>(null)
  let active: PreviewProcess | null = null

  async function detect(projectPath: string): Promise<ClassifyResult> {
    return classify(projectPath)
  }

  async function start(projectPath: string): Promise<void> {
    if (running.value || starting.value) return
    error.value = null
    starting.value = true

    try {
      // Sanity-check cwd first — a missing project directory produces an
      // opaque "No such file or directory (os error 2)" from spawn.
      const { exists } = await import('@tauri-apps/plugin-fs')
      if (!(await exists(projectPath))) {
        throw new Error(`Project folder not found: ${projectPath}`)
      }

      const c = await classify(projectPath)
      if (c.kind === 'unknown') {
        throw new Error(
          'Nothing to preview — no package.json scripts.dev, no index.html, and no server entry point found ' +
          'in the project root or first-level subdirectories (code/, app/, web/, frontend/, …).',
        )
      }

      const { Command } = await import('@tauri-apps/plugin-shell')
      // classify() resolved the actual runnable-app root — may be the
      // project root OR a subdir like <project>/code. Spawn from there
      // so the package manager / build tool sees the right context.
      const cwd = c.cwd ?? projectPath

      let cmd: ReturnType<typeof Command.create>
      if (c.kind === 'dev-server') {
        const pm = c.packageManager ?? 'bun'
        cmd = Command.create(pm, ['run', c.devScript!], { cwd })
      } else if (c.kind === 'go-server') {
        cmd = Command.create('go', ['run', '.'], { cwd })
      } else if (c.kind === 'python-server') {
        cmd = Command.create('python3', [c.devScript || 'main.py', ...(c.extraArgs ?? [])], { cwd })
      } else if (c.kind === 'rust-server') {
        cmd = Command.create('cargo', ['run'], { cwd })
      } else {
        // Static site: Bun serves HTML entrypoints natively with HMR.
        // `bun run index.html` (Bun 1.2+) starts a dev server, bundles
        // referenced assets, and prints `http://localhost:PORT` on stdout.
        // `devScript` here is a subdirectory (e.g. "web", "dist") when the
        // project's prebuilt output lives below the root.
        const staticCwd = c.devScript ? `${cwd}/${c.devScript}` : cwd
        cmd = Command.create('bun', ['run', '--port', String(c.fallbackPort ?? 5173), 'index.html'], { cwd: staticCwd })
      }

      // Watch stdout/stderr for the first localhost URL. Frameworks can
      // take a second or two to print this; we resolve as soon as we see
      // it, then open the browser window.
      const urlSeen = new Promise<string>((resolve) => {
        let resolved = false
        const onLine = (line: string) => {
          if (resolved) return
          const m = LOCAL_URL_RE.exec(line)
          if (m) {
            resolved = true
            resolve(m[1]!)
          }
        }
        cmd.stdout.on('data', onLine)
        cmd.stderr.on('data', onLine)
      })

      // Also watch for the child exiting before it binds — a common trap
      // for SSG/CLI Go/Python projects mistakenly classified as servers.
      const exited = new Promise<'exited'>((resolve) => {
        cmd.on('close', () => resolve('exited'))
      })

      const child = await cmd.spawn()
      active = { child }
      running.value = true

      // Give the child 6s to print a URL before we fall back to the
      // guessed port. 6s covers cold Vite + Next + friends; longer
      // means the user is probably staring at a broken build.
      const outcome = await Promise.race([
        urlSeen,
        exited,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
      ])

      if (outcome === 'exited') {
        throw new Error(
          `Preview process exited before binding a port. The project may be a build tool (SSG/CLI) rather than a dev server — try running the build first, then preview its output directory.`,
        )
      }

      const finalUrl = typeof outcome === 'string'
        ? outcome
        : `http://localhost:${c.fallbackPort ?? 5173}`
      active.url = finalUrl
      url.value = finalUrl

      // Open the in-app browser pointed at the dev server. The browser
      // window type already allowlists localhost (see openWindow tests).
      const { openWindow } = await import('@/lib/window/openWindow')
      await openWindow({ type: 'browser', url: finalUrl, title: 'Preview' })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      // Translate the opaque Rust IO error from plugin-shell spawn when the
      // binary isn't on PATH.
      error.value = /os error 2|No such file or directory/i.test(raw)
        ? `Couldn't start preview — command not found on PATH. Make sure the required runtime (bun/go/python3/cargo) is installed and visible to Construct.`
        : raw
      await stop()
    } finally {
      starting.value = false
    }
  }

  async function stop(): Promise<void> {
    if (!active) {
      running.value = false
      return
    }
    try { await active.child.kill() } catch { /* best-effort */ }
    active = null
    running.value = false
    url.value = null
  }

  return { starting, running, url, error, detect, start, stop }
}
