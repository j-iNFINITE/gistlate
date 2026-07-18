import { normalizeLang } from '../translate/lang'

export type CaptionTrackKind = 'manual' | 'asr'
export type TrackPurpose = 'direct-target' | 'translate-manual' | 'translate-asr'

/** Normalized subset of YouTube's unstable caption-track payload. */
export interface CaptionTrack {
  baseUrl: string
  languageCode: string
  kind: CaptionTrackKind
  vssId: string
  name?: string
  selected?: boolean
  audioLanguageMatch?: boolean
}

export interface SelectedCaptionTrack {
  videoId: string
  track: CaptionTrack
  purpose: TrackPurpose
}

/**
 * Select the one canonical track Gistlate will use for this video.
 *
 * Product order:
 * 1. target-language manual captions (display directly, no LLM)
 * 2. audio-language manual captions
 * 3. another deterministic manual track
 * 4. audio-language ASR
 * 5. another ASR track
 */
export function selectCanonicalTrack(
  videoId: string,
  tracks: CaptionTrack[],
  targetLanguage: string,
  audioLanguage?: string,
): SelectedCaptionTrack | null {
  if (tracks.length === 0) return null

  const target = normalizeLang(targetLanguage)
  const audio = audioLanguage ? normalizeLang(audioLanguage) : ''
  const manual = tracks.filter((track) => track.kind === 'manual')
  const asr = tracks.filter((track) => track.kind === 'asr')

  const direct = preferred(
    manual.filter((track) => normalizeLang(track.languageCode) === target),
    audio,
  )
  if (direct) return { videoId, track: direct, purpose: 'direct-target' }

  const audioManual = preferred(
    manual.filter((track) => isAudioLanguageTrack(track, audio)),
    audio,
  )
  if (audioManual) return { videoId, track: audioManual, purpose: 'translate-manual' }

  const anotherManual = preferred(manual, audio)
  if (anotherManual) return { videoId, track: anotherManual, purpose: 'translate-manual' }

  const audioAsr = preferred(
    asr.filter((track) => isAudioLanguageTrack(track, audio)),
    audio,
  )
  if (audioAsr) return { videoId, track: audioAsr, purpose: 'translate-asr' }

  const anotherAsr = preferred(asr, audio)
  return anotherAsr ? { videoId, track: anotherAsr, purpose: 'translate-asr' } : null
}

function isAudioLanguageTrack(track: CaptionTrack, normalizedAudio: string): boolean {
  return track.audioLanguageMatch === true || (
    normalizedAudio !== '' && normalizeLang(track.languageCode) === normalizedAudio
  )
}

/** Stable tie-breaks inside one product-priority tier. */
function preferred(tracks: CaptionTrack[], normalizedAudio: string): CaptionTrack | undefined {
  return [...tracks].sort((left, right) => {
    const audio = scoreAudio(right, normalizedAudio) - scoreAudio(left, normalizedAudio)
    if (audio !== 0) return audio
    // Unnamed tracks are normally the creator's canonical captions.
    const unnamed = Number(Boolean(left.name)) - Number(Boolean(right.name))
    if (unnamed !== 0) return unnamed
    const selected = Number(Boolean(right.selected)) - Number(Boolean(left.selected))
    if (selected !== 0) return selected
    return 0 // stable Array#sort preserves YouTube's original order
  })[0]
}

function scoreAudio(track: CaptionTrack, normalizedAudio: string): number {
  return isAudioLanguageTrack(track, normalizedAudio) ? 1 : 0
}

export function captionTrackKey(videoId: string, track: CaptionTrack): string {
  return [videoId, normalizeLang(track.languageCode), track.kind, track.vssId].join(':')
}

export function captionTrackNeedsTranslation(
  selected: SelectedCaptionTrack,
  targetLanguage: string,
): boolean {
  return selected.purpose !== 'direct-target' &&
    normalizeLang(selected.track.languageCode) !== normalizeLang(targetLanguage)
}

/** Match an observed timedtext request to the already selected canonical track. */
export function isSameCaptionTrack(left: CaptionTrack, right: CaptionTrack): boolean {
  if (left.vssId || right.vssId) return Boolean(left.vssId) && left.vssId === right.vssId
  return normalizeLang(left.languageCode) === normalizeLang(right.languageCode) &&
    left.kind === right.kind
}
