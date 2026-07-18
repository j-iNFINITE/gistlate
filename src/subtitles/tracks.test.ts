import { describe, expect, it } from 'vitest'
import {
  captionTrackNeedsTranslation,
  captionTrackKey,
  isSameCaptionTrack,
  selectCanonicalTrack,
  type CaptionTrack,
} from './tracks'

function track(
  languageCode: string,
  kind: CaptionTrack['kind'],
  options: Partial<CaptionTrack> = {},
): CaptionTrack {
  return {
    baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`,
    languageCode,
    kind,
    vssId: `${kind}:${languageCode}`,
    ...options,
  }
}

describe('canonical YouTube caption track selection', () => {
  it('directly displays a target-language manual track before every translation source', () => {
    const selected = selectCanonicalTrack('vid', [
      track('ja', 'manual', { audioLanguageMatch: true }),
      track('zh-CN', 'manual'),
    ], 'zh-Hans', 'ja')

    expect(selected?.purpose).toBe('direct-target')
    expect(selected?.track.languageCode).toBe('zh-CN')
  })

  it('prefers audio-language manual captions when all manual tracks need translation', () => {
    const selected = selectCanonicalTrack('vid', [
      track('en', 'manual'),
      track('ja', 'manual'),
      track('ja', 'asr'),
    ], 'zh-Hans', 'ja')

    expect(selected).toMatchObject({ purpose: 'translate-manual', track: { languageCode: 'ja' } })
  })

  it('keeps every manual track ahead of audio-language ASR', () => {
    const selected = selectCanonicalTrack('vid', [
      track('en', 'manual'),
      track('ja', 'asr', { audioLanguageMatch: true }),
    ], 'zh-Hans', 'ja')

    expect(selected).toMatchObject({ purpose: 'translate-manual', track: { languageCode: 'en' } })
  })

  it('uses unnamed then selected manual tracks as deterministic tie-breaks', () => {
    const unnamed = track('en', 'manual', { vssId: '.en' })
    const namedSelected = track('fr', 'manual', {
      vssId: '.fr',
      name: 'French',
      selected: true,
    })
    expect(selectCanonicalTrack('vid', [namedSelected, unnamed], 'zh-Hans')?.track).toBe(unnamed)

    const named = track('de', 'manual', { name: 'German' })
    expect(selectCanonicalTrack('vid', [named, namedSelected], 'zh-Hans')?.track).toBe(namedSelected)
  })

  it('falls back from audio-language ASR to another ASR', () => {
    expect(selectCanonicalTrack('vid', [
      track('en', 'asr'),
      track('ja', 'asr'),
    ], 'zh-Hans', 'ja')?.track.languageCode).toBe('ja')

    expect(selectCanonicalTrack('vid', [track('en', 'asr')], 'zh-Hans', 'ja')?.purpose)
      .toBe('translate-asr')
  })

  it('normalizes identity and falls back to language/kind only when vssId is absent', () => {
    const a = track('zh-CN', 'manual', { vssId: '' })
    const b = track('zh-Hans', 'manual', { vssId: '' })
    const c = track('zh-Hans', 'asr', { vssId: '' })
    expect(isSameCaptionTrack(a, b)).toBe(true)
    expect(isSameCaptionTrack(a, c)).toBe(false)
    expect(isSameCaptionTrack(a, track('zh-Hans', 'manual'))).toBe(false)
    expect(captionTrackKey('vid', a)).toBe('vid:zh-Hans:manual:')
  })

  it('bypasses translation for direct-target manual tracks and any same-language source', () => {
    const direct = selectCanonicalTrack('vid', [track('zh-CN', 'manual')], 'zh-Hans')!
    expect(captionTrackNeedsTranslation(direct, 'zh-Hans')).toBe(false)
    expect(captionTrackNeedsTranslation({
      videoId: 'vid',
      track: track('zh-CN', 'asr'),
      purpose: 'translate-asr',
    }, 'zh-Hans')).toBe(false)
    expect(captionTrackNeedsTranslation({
      videoId: 'vid',
      track: track('ja', 'manual'),
      purpose: 'translate-manual',
    }, 'zh-Hans')).toBe(true)
  })
})
