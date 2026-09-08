/**
 * keyGuard — protect editable focus from global key-listener hijacking.
 *
 * Spaces (marketplace IIFEs) run in the same global realm as the host. A
 * space that binds `window.addEventListener('keydown', ...)` for game
 * controls (wasd, arrow keys) keeps firing even when the user is typing
 * into a host input like the Assistant — and if its handler calls
 * `e.preventDefault()`, the input loses characters entirely. Same shape
 * enables a hostile space to quietly observe every keystroke the user
 * types anywhere in the host.
 *
 * Fix: wrap `window.addEventListener` and `document.addEventListener` so
 * every registered key listener is bypassed when focus is in an editable
 * element (input / textarea / contenteditable) AND the key is a plain
 * typing key (no Cmd/Ctrl). Host shortcuts with modifiers (Cmd+K, Cmd+Z,
 * Cmd+Alt+I, etc.) still pass through unchanged.
 *
 * Caveats:
 *  - Listeners attached DIRECTLY to a specific element (e.g. the input
 *    itself) are unaffected — those are what the focused input uses.
 *  - Keyboard events with Cmd/Ctrl modifiers still reach window listeners,
 *    so host shortcuts keep working while an input is focused.
 *  - Listener de-registration works because we map (target, type,
 *    originalCallback, options-key) → wrapped callback.
 */

type ListenerMap = WeakMap<EventListenerOrEventListenerObject, Map<string, EventListenerOrEventListenerObject>>

const KEY_EVENTS = new Set(['keydown', 'keypress', 'keyup'])

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  // Fallback: `isContentEditable` isn't set reliably in some environments
  // (e.g. jsdom) — check the attribute directly too. "inherit" is treated
  // as non-editable here because we can't cheaply resolve the ancestor's
  // effective mode.
  const attr = el.getAttribute('contenteditable')
  if (attr === '' || attr === 'true' || attr === 'plaintext-only') return true
  if (EDITABLE_TAGS.has(el.tagName)) return true
  return false
}

function optionsKey(opts: boolean | AddEventListenerOptions | undefined): string {
  if (opts === true) return 'c:1'
  if (opts === false || opts === undefined) return 'c:0'
  const capture = opts.capture ? 1 : 0
  const once = opts.once ? 1 : 0
  const passive = opts.passive ? 1 : 0
  return `c:${capture};o:${once};p:${passive}`
}

let installed = false

export function installKeyGuard(): void {
  if (installed) return
  installed = true

  const targets: EventTarget[] = [window, document]
  for (const target of targets) {
    const proto = Object.getPrototypeOf(target)
    // Only patch EventTarget-level methods — window + document inherit
    // from EventTarget so patching their OWN instance methods lets us
    // avoid mutating the global prototype that every element also uses.
    const origAdd = target.addEventListener.bind(target)
    const origRemove = target.removeEventListener.bind(target)

    // Map: originalCallback → (optionsKey → wrappedCallback).
    // Keyed on the originalCallback so addEventListener/removeEventListener
    // pairs resolve the same wrapped function.
    const map: ListenerMap = new WeakMap()

    target.addEventListener = function (
      type: string,
      cb: EventListenerOrEventListenerObject | null,
      opts?: boolean | AddEventListenerOptions,
    ): void {
      if (!cb || !KEY_EVENTS.has(type)) {
        return origAdd(type, cb, opts)
      }

      let byOpts = map.get(cb)
      if (!byOpts) {
        byOpts = new Map()
        map.set(cb, byOpts)
      }
      const key = optionsKey(opts)
      let wrapped = byOpts.get(key)
      if (!wrapped) {
        wrapped = function (ev: Event) {
          const ke = ev as KeyboardEvent
          // Pass through when a modifier is held — host shortcuts use
          // Cmd/Ctrl; typing-into-input doesn't.
          const hasCmd = ke.metaKey || ke.ctrlKey
          if (!hasCmd && isEditableFocused()) {
            return
          }
          if (typeof cb === 'function') cb(ev)
          else cb.handleEvent?.(ev)
        }
        byOpts.set(key, wrapped)
      }
      return origAdd(type, wrapped, opts)
    } as typeof target.addEventListener

    target.removeEventListener = function (
      type: string,
      cb: EventListenerOrEventListenerObject | null,
      opts?: boolean | EventListenerOptions,
    ): void {
      if (!cb || !KEY_EVENTS.has(type)) {
        return origRemove(type, cb, opts)
      }
      const byOpts = map.get(cb)
      const wrapped = byOpts?.get(optionsKey(opts as AddEventListenerOptions))
      if (wrapped) {
        byOpts!.delete(optionsKey(opts as AddEventListenerOptions))
        return origRemove(type, wrapped, opts)
      }
      // Fallback: they may have added without going through us (e.g. an
      // addEventListener registered before install) — try the original ref.
      return origRemove(type, cb, opts)
    } as typeof target.removeEventListener

    // We don't patch the prototype, so this is already instance-scoped.
    void proto
  }
}
