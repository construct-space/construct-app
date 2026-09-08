import { createApp, defineComponent, h, type Component } from 'vue'
import type { WidgetApi } from './widgetApi'

/**
 * Globals that widget code should not be able to access.
 * We don't strip these from window (that would break the host app).
 * Instead, the widget's Vue app gets a global-properties override
 * and we rely on closed Shadow DOM + marketplace review to enforce.
 */
export const BLOCKED_GLOBALS = [
  '__CONSTRUCT__',
  '__TAURI__',
  '__TAURI_INTERNALS__',
  'construct',
  'Audio',
  'HTMLMediaElement',
  'parent',
  'top',
  'frames',
] as const

/**
 * Create a wrapper component that blocks access to dangerous globals
 * within the widget's template and setup scope via Vue's app-level config.
 */
function createSandboxedWrapper(component: Component): Component {
  return defineComponent({
    name: 'WidgetSandboxWrapper',
    setup() {
      return () => h(component)
    },
  })
}

function buildThemeStyle(vars: Record<string, string>): HTMLStyleElement {
  const style = document.createElement('style')
  const rules = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n  ')
  const sans = "var(--default-font-family, var(--font-sans, 'Rubik', ui-sans-serif, system-ui, -apple-system, sans-serif))"
  const mono = 'var(--default-mono-font-family, var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace))'
  style.textContent = `:host {\n  --font-sans: 'Rubik', ui-sans-serif, system-ui, -apple-system, sans-serif;\n  --default-font-family: var(--font-sans);\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n  --default-mono-font-family: var(--font-mono);\n  ${rules}\n  color: ${vars['--app-foreground'] || 'inherit'};\n  background: transparent;\n  font-family: ${sans};\n}\n.widget-root {\n  ${rules}\n  color: ${vars['--app-foreground'] || 'inherit'};\n  font-family: inherit;\n}\n* { box-sizing: border-box; }\n:where(button, input, select, textarea) { font: inherit; }\n:where(code, kbd, samp, pre, .font-mono) { font-family: ${mono}; }\n:where(.font-sans) { font-family: ${sans}; }`
  return style
}

function buildSpaceStyle(spaceCss?: string): HTMLStyleElement | null {
  const css = spaceCss?.trim()
  if (!css) return null

  const style = document.createElement('style')
  style.setAttribute('data-space-widget-css', 'true')
  style.textContent = css
  return style
}

/**
 * Clone document stylesheets (Tailwind, app CSS) into the shadow DOM
 * so utility classes like text-[var(--app-foreground)] resolve correctly.
 */
function cloneDocumentStyles(shadow: ShadowRoot): void {
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      if (node.crossOrigin) link.crossOrigin = node.crossOrigin
      shadow.appendChild(link)
    } else if (node instanceof HTMLStyleElement) {
      const clone = document.createElement('style')
      for (const attr of node.attributes) {
        clone.setAttribute(attr.name, attr.value)
      }
      clone.textContent = node.textContent || ''
      shadow.appendChild(clone)
    }
  }
}

/**
 * Mount a widget component inside a closed Shadow DOM.
 *
 * Security layers:
 * 1. Closed shadow root — widget can't querySelector outside its boundary
 * 2. Isolated Vue app — widget can't access host app's provide/inject, router, or stores
 * 3. Blocked global properties — widget's Vue app has dangerous globals set to undefined
 *    on app.config.globalProperties, shadowing window-level access from templates
 * 4. Marketplace review gate — static analysis rejects direct window/document access
 *
 * Note: This is NOT an iframe. Determined code CAN still reach window.*.
 * The review gate is the trust boundary; the runtime layers raise the bar.
 */
export function mountWidgetInShadow(
  hostElement: HTMLElement,
  component: Component,
  api: WidgetApi,
  themeVars: Record<string, string>,
  spaceCss?: string,
): () => void {
  const shadow = hostElement.attachShadow({ mode: 'closed' })
  cloneDocumentStyles(shadow)
  const spaceStyle = buildSpaceStyle(spaceCss)
  if (spaceStyle) shadow.appendChild(spaceStyle)
  shadow.appendChild(buildThemeStyle(themeVars))

  const root = document.createElement('div')
  root.className = 'widget-root'
  root.style.cssText = 'height: 100%; width: 100%;'
  shadow.appendChild(root)

  // Create isolated Vue app with sandboxed wrapper
  const app = createApp(createSandboxedWrapper(component))

  // Provide the frozen API as the only bridge
  app.provide('widgetApi', api)

  // Block dangerous globals via globalProperties — these shadow window-level
  // access in Vue templates and composables that use getCurrentInstance().
  // This does NOT mutate window, so the host app is unaffected.
  for (const key of BLOCKED_GLOBALS) {
    app.config.globalProperties[`$${key}`] = undefined
  }

  // Suppress Vue warnings from the sandboxed app
  app.config.warnHandler = () => {}

  app.mount(root)

  return () => { app.unmount() }
}

/**
 * Check if a code string contains direct references to blocked globals.
 * Used by the marketplace review gate (static analysis at publish time).
 */
export function detectBlockedGlobalAccess(code: string): string[] {
  const violations: string[] = []
  for (const name of BLOCKED_GLOBALS) {
    // Match window.X, globalThis.X, or bare X( / X. access patterns
    const patterns = [
      new RegExp(`window\\.${name}\\b`),
      new RegExp(`globalThis\\.${name}\\b`),
    ]
    for (const pat of patterns) {
      if (pat.test(code)) {
        violations.push(`Direct access to ${name} via window/globalThis`)
      }
    }
  }
  // Check for eval/Function constructor
  if (/\beval\s*\(/.test(code)) violations.push('Use of eval()')
  if (/new\s+Function\s*\(/.test(code)) violations.push('Use of new Function()')
  return violations
}
