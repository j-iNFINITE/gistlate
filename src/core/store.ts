import type { Cue } from '../subtitles/timedtext'

export type Source = 'l1' | 'l2' | 'fresh'
export type Listener = (currentTime: number) => void

export interface SubtitleState {
  /** Whether a subtitle track is loaded. */
  loaded: boolean
  /** Source language (BCP-47 normalized). */
  srcLang: string
  /** All cues for the current video. */
  cues: Cue[]
}

export interface ResolveResult {
  cues: Cue[]
  source: Source
}

/**
 * Single shared state container.
 * Holds current subtitle cues, playback position, and abort controls.
 */
class Store {
  subtitle: SubtitleState | null = null
  currentTime = 0

  private listeners = new Set<Listener>()
  private abortController = new AbortController()

  // ── Subtitle data ─────────────────────────────

  setSubtitle(srcLang: string, cues: Cue[]): void {
    this.subtitle = { loaded: true, srcLang, cues }
  }

  reset(): void {
    this.abortController.abort()
    this.subtitle = null
    this.currentTime = 0
    this.abortController = new AbortController()
  }

  // ── Playhead ──────────────────────────────────

  setCurrentTime(time: number): void {
    this.currentTime = time
    this.listeners.forEach((fn) => fn(time))
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // ── Abort / cancellation ──────────────────────

  get signal(): AbortSignal {
    return this.abortController.signal
  }
}

export const store = new Store()
