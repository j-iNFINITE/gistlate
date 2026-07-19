export interface AutoStartState {
  videoId: string | null
  autoStart: boolean
  activeVideoId: string | null
  suppressedVideoId: string | null
  guardedVideoId: string | null
}

/** Pure policy used by initial load and every YouTube SPA navigation. */
export function shouldAutoStartVideo(state: AutoStartState): state is AutoStartState & { videoId: string } {
  return Boolean(
    state.videoId && state.autoStart &&
    state.videoId !== state.activeVideoId &&
    state.videoId !== state.suppressedVideoId &&
    state.videoId !== state.guardedVideoId,
  )
}

export interface DeactivationState {
  reason: 'user' | 'navigation'
  activeVideoId: string | null
  trackVideoId: string | null
  currentVideoId: string | null
  previousPageVideoId: string | null
}

/** Choose the old video whose staged timedtext state is safe to discard. */
export function deactivatedVideoId(state: DeactivationState): string | null {
  return state.activeVideoId || state.trackVideoId || (
    state.reason === 'user' ? state.currentVideoId : state.previousPageVideoId
  )
}
