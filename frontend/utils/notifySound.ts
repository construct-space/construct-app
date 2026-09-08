/**
 * Audible alert for scheduled notify-class tasks (alarms, timers) that set
 * `notify.sound`. The OS-level notification sound is unreliable - off by
 * default on macOS, varies by platform - so when a sound notify fires while the
 * app is alive we play a short Web Audio chime app-wide, independent of which
 * page is open. (The native Rust local scheduler still plays the OS sound when
 * the app is closed/offline; the two never fire together - see
 * local_alarms_try_fire dedup.)
 *
 * The AudioContext is primed on the first user gesture so a later alarm can play
 * without a fresh gesture (browser autoplay policy).
 */

let ctx: AudioContext | null = null
let primed = false

function ensureCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    if (!ctx) ctx = new Ctx()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Call once at boot. Resumes/creates the AudioContext on the first user
 *  gesture so a later alarm/timer can sound without a fresh gesture. */
export function primeNotifySound(): void {
  if (primed) return
  primed = true
  const onGesture = () => { ensureCtx() }
  window.addEventListener('pointerdown', onGesture, { passive: true })
  window.addEventListener('keydown', onGesture, { passive: true })
}

/** Three short rising beeps - a recognizable alert without shipping an asset. */
export function playNotifySound(): void {
  const c = ensureCtx()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume()
    const now = c.currentTime
    const freqs = [880, 1108, 1318]
    freqs.forEach((f, i) => {
      const t = now + i * 0.22
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      osc.connect(gain).connect(c.destination)
      osc.start(t)
      osc.stop(t + 0.22)
    })
  } catch {
    /* ignore */
  }
}
