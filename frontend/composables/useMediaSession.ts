/**
 * useMediaSession — host-owned "now playing" store.
 *
 * Why this lives in the host and not in a space:
 *   A space's audio engine (a module-level `new Audio()` in e.g.
 *   space-podcasts / space-radio) keeps playing after you navigate away —
 *   the space module is cached and never unloaded on navigation, and the
 *   Audio element isn't in the DOM so it survives. What does NOT survive is
 *   the space's player *UI*: its components unmount with the route, so the
 *   transport controls vanish the moment you leave the space.
 *
 *   This store is the missing persistent layer. The playing space publishes
 *   its now-playing metadata + transport state here and registers control
 *   callbacks (closures over its still-alive audio singleton). The host
 *   renders one persistent title-bar player (NowPlaying.vue) bound to this
 *   store, so playback stays visible and controllable across space switches.
 *
 * The host never owns the audio element — it owns the *state + control
 * routing*. Controls are plain callbacks, so when the host UI calls
 * `toggle()` it reaches straight into the owning space's audio.
 *
 * Exposed to spaces via constructSdk.ts as `useMediaSession`.
 */

import { reactive } from 'vue'

export interface MediaTrack {
  /** Owning space id — used to navigate back to it from the title bar. */
  spaceId: string
  /** Page path within the space to return to (optional; defaults to root). */
  page?: string
  title: string
  subtitle?: string
  /** Artwork URL (cover image). */
  artwork?: string
}

export interface MediaControls {
  toggle?: () => void
  play?: () => void
  pause?: () => void
  skipForward?: () => void
  skipBack?: () => void
  stop?: () => void
  seek?: (seconds: number) => void
}

export interface MediaSessionState {
  track: MediaTrack | null
  isPlaying: boolean
  isBuffering: boolean
  /** Playhead in seconds. */
  position: number
  /** Total duration in seconds once known. */
  duration: number
}

// Module-level singleton — one now-playing slot for the whole app window.
const state = reactive<MediaSessionState>({
  track: null,
  isPlaying: false,
  isBuffering: false,
  position: 0,
  duration: 0,
})

let controls: MediaControls = {}

// Which transport controls the current space registered. The title-bar player
// reads this to show only the buttons that actually do something - e.g. radio
// (live streams) registers no skip, so the skip buttons hide; podcasts
// registers skip 15s/30s, so they show.
const capabilities = reactive({ skipForward: false, skipBack: false, seek: false })

export function useMediaSession() {
  /** Space → host: set/replace what's playing. Pass null to keep the slot
   *  but drop the track (rare); use clear() to fully reset. */
  function setTrack(track: MediaTrack | null) {
    state.track = track
  }

  /** Space → host: patch transport state (isPlaying/position/duration/…). */
  function publish(patch: Partial<MediaSessionState>) {
    Object.assign(state, patch)
  }

  /** Space → host: register transport callbacks. The closures capture the
   *  space's audio singleton and stay valid after the space UI unmounts. */
  function registerControls(c: MediaControls) {
    controls = c
    capabilities.skipForward = !!c.skipForward
    capabilities.skipBack = !!c.skipBack
    capabilities.seek = !!c.seek
  }

  /** Space → host: playback ended/stopped — clear the slot and controls. */
  function clear() {
    state.track = null
    state.isPlaying = false
    state.isBuffering = false
    state.position = 0
    state.duration = 0
    controls = {}
    capabilities.skipForward = false
    capabilities.skipBack = false
    capabilities.seek = false
  }

  // Host UI → space: transport actions, routed to the registered callbacks.
  const toggle = () => controls.toggle?.()
  const play = () => controls.play?.()
  const pause = () => controls.pause?.()
  const skipForward = () => controls.skipForward?.()
  const skipBack = () => controls.skipBack?.()
  const stop = () => controls.stop?.()
  const seek = (seconds: number) => controls.seek?.(seconds)

  return {
    state,
    capabilities,
    setTrack,
    publish,
    registerControls,
    clear,
    toggle,
    play,
    pause,
    skipForward,
    skipBack,
    stop,
    seek,
  }
}
